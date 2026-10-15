import { props } from '@webflow/data-types'
import { declareComponent } from '@webflow/react'
import { StaffConsole } from './StaffConsole'

export default declareComponent(StaffConsole, {
  name: 'Staff Console',
  description: 'Staff-only Starter lookup and remove/restore. Xano checks staff access on every call.',
  group: 'Admin',
  props: {
    title: props.Text({
      name: 'Title',
      defaultValue: 'Staff console',
    }),
    loginUrl: props.Text({
      name: 'Login URL',
      defaultValue: '/login?next=/staff',
    }),
  },
})
