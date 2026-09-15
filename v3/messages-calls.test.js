const test = require('node:test')
const assert = require('node:assert/strict')
const { isBrand, selection, createController } = require('./messages-calls')
const { selectBookableConfigurations } = require('./free-call-booking')
const brand = { id: 'mem_brand', planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', active: true }] }
const starter = { id: 'mem_starter', planConnections: [{ planId: 'pln_dorxata-test-free-plan-dvcg0k8o', active: true }] }
const event = (id = 'a') => ({ conversation: { id }, others: [{ id: 'mem_' + id }] })
const result = types => ({ configs: types.map(type => ({ is_paid: type === 'paid' })) })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function setup(overrides = {}) {
  const calls = { clear: 0, shown: [], opened: [], unavailable: [] }
  const controller = createController({ member: brand,
    unavailable: r => calls.unavailable.push(r), clear: () => calls.clear++, show: r => calls.shown.push(r),
    discover: async () => result(['free']), open: async r => { calls.opened.push(r); return true },
    ...overrides,
  })
  return { controller, calls }
}
test('only known active Brand plans admit scheduling', () => {
  assert.equal(isBrand(brand), true)
  for (const member of [starter, null, { planConnections: [] }, {customFields:{'brands-dashboard-url':'/brand-dashboard'}},
    { planConnections: [{planId:'unknown',active:true}] },
    { planConnections: [{planId:'pln_new-paid-plan-463h04ph',active:false}] },
    {planConnections:[...brand.planConnections,...starter.planConnections]}]) assert.equal(isBrand(member), false)
  assert.equal(isBrand({planConnections:[{planId:'pln_free-plan-f6kn0dxz',status:'ACTIVE'}]}), true)
})
test('selection requires one other member and a selected conversation', () => {
  assert.deepEqual(selection(event(), brand.id), {conversationId:'a',memberId:'mem_a'})
  assert.equal(selection({others:[{id:'mem_a'}]}, brand.id), null)
  assert.equal(selection({...event(),others:[{id:'mem_a'},{id:'mem_b'}]},brand.id),null)
  assert.equal(selection({...event(),others:[{id:'bad'}]},brand.id),null)
  assert.deepEqual(selection({conversation:{id:'x',participants:{mem_brand:{},mem_a:{}}}},brand.id),{conversationId:'x',memberId:'mem_a'})
})
for (const types of [[],['free'],['paid'],['free','paid']]) {
  test('availability ' + (types.join('+') || 'neither'), async () => {
    const {controller,calls}=setup({discover:async()=>result(types)})
    await controller.select(event())
    assert.equal(calls.shown.length,types.length ? 1 : 0)
    assert.equal(calls.unavailable.length,types.length ? 0 : 1)
    await controller.open()
    assert.equal(calls.opened.length,types.length ? 1 : 0)
    if(types.length) assert.deepEqual(calls.opened[0].configs,result(types).configs)
  })
}
test('Starter never discovers or opens a call',async()=>{
  let reads=0
  const {controller,calls}=setup({member:starter,discover:async()=>{reads++;return result(['free'])}})
  await controller.select(event());await controller.open()
  assert.equal(reads,0);assert.equal(calls.shown.length,0);assert.equal(calls.opened.length,0)
})
test('late previous participant response cannot reveal a stale button',async()=>{
  const first=deferred()
  const {controller,calls}=setup({discover:t=>t.memberId==='mem_a'?first.promise:Promise.resolve(result(['paid']))})
  const a=controller.select(event('a'));await controller.select(event('b'))
  first.resolve(result(['free']));await a
  assert.equal(calls.clear,2);assert.deepEqual(calls.shown.map(r=>r.memberId),['mem_b'])
})
test('selection change cancels an in-flight entry recheck',async()=>{
  const next=deferred();let reads=0
  const {controller,calls}=setup({discover:()=>++reads===2?next.promise:Promise.resolve(result(['free']))})
  await controller.select(event('a'));const opening=controller.open()
  await controller.select(event('b'));next.resolve(result(['free']));await opening
  assert.equal(calls.opened.length,0)
})
test('disabled call stays visible at entry while failed reads clear the control',async()=>{
  for(const failure of [false,true]) {
    let reads=0
    const {controller,calls}=setup({discover:async()=>{if(++reads===1)return result(['free']);if(failure)throw Error('offline');return result([])}})
    await controller.select(event());assert.equal(await controller.open(),false)
    assert.equal(calls.opened.length,0);assert.equal(calls.clear,2)
    assert.equal(calls.unavailable.length,failure ? 0 : 1)
  }
})
test('rapid repeated clicks share one entry attempt',async()=>{
  const pending=deferred();let reads=0
  const {controller,calls}=setup({discover:()=>++reads===1?Promise.resolve(result(['free'])):pending.promise})
  await controller.select(event());const first=controller.open();assert.equal(await controller.open(),false)
  pending.resolve(result(['free']));await first;assert.equal(reads,2);assert.equal(calls.opened.length,1)
})
test('shared Hire admission rejects duplicate and cross-environment configurations',()=>{
  const free={active:true,config_id:'free',is_paid:false,price_cents:0,duration:30,data_environment:'production'}
  const paid={active:true,config_id:'paid',is_paid:true,price_cents:10000,duration:60,currency:'USD',data_environment:'production',payment_environment:'live'}
  assert.deepEqual(selectBookableConfigurations([paid,free],'www.thestarters.com'),[free,paid])
  assert.deepEqual(selectBookableConfigurations([free,{...free,config_id:'second'}],'www.thestarters.com'),[])
  assert.deepEqual(selectBookableConfigurations([paid,free],'the-starters-3-0.webflow.io'),[])
  assert.deepEqual(selectBookableConfigurations([{...paid,payment_environment:'test'}],'www.thestarters.com'),[])
})

test('native adapter routes both to chooser and single types directly, with no booking request',async t=>{
  const adapter=require('./messages-calls')
  for(const scenario of [['free','paid'],['free'],['paid'],[],'no-calendar','offline','missing-starter']) await t.test(Array.isArray(scenario)?scenario.join('+')||'neither':scenario,async()=>{
    const types=Array.isArray(scenario)?scenario:[]
    const visible=Array.isArray(scenario)||scenario==='no-calendar'
    const names=['document','location','addEventListener','lumos','__tsSchedulingAuthFetch','StartersPaidCallBrandPayment','StartersFreeCallBooking','StartersBookingSurfaceLifecycle','fetch']
    const previous=Object.fromEntries(names.map(n=>[n,global[n]]))
    function node(attrs={}) {
      return {attrs:{...attrs},style:{},listeners:{},textContent:'',
        setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},getAttribute(k){return this.attrs[k]??null},
        addEventListener(k,fn){this.listeners[k]=fn},querySelector(){return null},
        appendChild(child){this.child=child},contains(target){return target===this},
        getBoundingClientRect(){return {left:20,top:740,bottom:784,width:180,height:44}},
      }
    }
    const button=node(),trigger=node(),wrapper=node({'data-messages-call-hidden':''}),chooser=node(),popup=node()
    const opened=[], clicked=[]
    const registry={
      'popup-booking-main':{el:chooser,open(){chooser.open=true;opened.push('chooser')},close(){chooser.open=false}},
      'popup-booking':{el:popup,open(){popup.open=true},close(){popup.open=false}},
    }
    const rows=['free','paid'].map(type=>{
      const row=node(),nearest=node(),cta=node({'data-type':type})
      cta.closest=()=>row;row.querySelector=()=>nearest
      cta.click=()=>{clicked.push(type);chooser.open=false;popup.open=true;if(cta.onclick)cta.onclick({preventDefault(){}})}
      return cta
    })
    wrapper.querySelector=()=>trigger;trigger.querySelector=()=>button
    let selected
    global.addEventListener=()=>{}
    global.document={createElement:()=>node(),body:node(),documentElement:{clientWidth:390,clientHeight:844},addEventListener(){},querySelector(s){return s==='[booking-button-wrapper]'?wrapper:s==='[popup-booking-main]'?chooser:s==='[popup-booking]'?popup:null},querySelectorAll(){return rows}}
    global.location={hostname:'www.thestarters.com'}
    global.lumos={modal:{list:registry}}
    global.__tsSchedulingAuthFetch=()=>{}
    global.StartersBookingSurfaceLifecycle={reset(){}}
    global.StartersFreeCallBooking={
      STARTER_PATH:'/starter',CONFIGS_PATH:'/configs',
      authenticatedRequest:async(path)=>{
        if(typeof scenario==='string') throw Object.assign(Error('lookup'),{status:scenario==='offline'?503:404,data:{message:scenario==='no-calendar'?'Bookable Starter calendar not found':'Starter not found'}})
        return path==='/starter'?({id:1,nylas_grant_id:'grant'}):types.map(type=>({config_id:type,is_paid:type==='paid',active:true,data_environment:'production',payment_environment:'live',currency:'USD',price_cents:type==='paid'?10000:0,duration:type==='paid'?60:30}))},
      selectBookableConfigurations:records=>selectBookableConfigurations(records,'www.thestarters.com'),
      installFreeBookingController(){return true},getNearestSlot:async()=>null,
    }
    global.StartersPaidCallBrandPayment={installPaidBookingController(){return true}}
    global.fetch=async()=>({ok:true,json:async()=>({starter_id:1,slug:'starter',items:types.map(type=>({type,public_available:true}))})})
    try {
      const controller=adapter.install({inbox:{onConversationSelected(fn){selected=fn}},member:{...brand,auth:{email:'brand@example.com'}},identity:{prefetch:async()=> 'starter'}})
      await selected(event())
      assert.equal(wrapper.getAttribute('data-messages-call-hidden'),visible?null:'')
      assert.equal(button.getAttribute('aria-disabled'),visible&&!types.length ? 'true' : null)
      if (visible&&!types.length) {
        await button.listeners.click({preventDefault(){},stopPropagation(){}})
        assert.equal(global.document.body.child.style.display,'block')
        assert.equal(global.document.body.child.textContent,'This Starter isn’t accepting calls right now.')
        button.listeners.keydown({key:'Escape'})
        assert.equal(global.document.body.child.style.display,'none')
      }
      await controller.open();await new Promise(r=>setTimeout(r,20))
      assert.deepEqual(opened,types.length?['chooser']:[])
      assert.deepEqual(clicked,types.length===1?types:[])
      if(types.length) assert.equal(popup.getAttribute('data-booking-entry'),types.length===1?'direct':'chooser')
      assert.deepEqual(rows.filter(c=>c.closest().style.display==='block').map(c=>c.getAttribute('data-type')),types)
      await selected({conversation:null});assert.equal(wrapper.getAttribute('data-messages-call-hidden'),'')
      assert.equal(chooser.open||false,false);assert.equal(popup.open||false,false)
    } finally { for(const n of names) if(previous[n]===undefined)delete global[n];else global[n]=previous[n] }
  })
})

test('unavailable selection cannot open or leak across conversation changes',async()=>{
  let reads=0
  const {controller,calls}=setup({discover:async()=>{reads++;return result([])}})
  await controller.select(event('a'))
  assert.deepEqual(calls.unavailable.map(x=>x.memberId),['mem_a'])
  assert.equal(await controller.open(),false)
  assert.equal(reads,1)
  await controller.select({conversation:null})
  assert.equal(await controller.open(),false)
  assert.equal(calls.opened.length,0)
})
test('late unavailable result cannot replace a ready conversation',async()=>{
  const pending=deferred()
  const {controller,calls}=setup({discover:t=>t.memberId==='mem_a'?pending.promise:Promise.resolve(result(['free']))})
  const first=controller.select(event('a'))
  await controller.select(event('b'))
  pending.resolve(result([]));await first
  assert.equal(calls.unavailable.length,0)
  assert.deepEqual(calls.shown.map(x=>x.memberId),['mem_b'])
})
