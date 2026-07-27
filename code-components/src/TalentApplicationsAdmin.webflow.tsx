import { props } from '@webflow/data-types'
import { declareComponent } from '@webflow/react'
import { TalentApplicationsAdmin } from './TalentApplicationsAdmin'

export default declareComponent(TalentApplicationsAdmin, {
  name: 'Talent Applications Admin',
  description: 'Secure staff dashboard for reviewing V3 talent applications in Xano.',
  group: 'Admin',
  props: {
    title: props.Text({
      name: 'Title',
      defaultValue: 'Talent applications',
    }),
    loginUrl: props.Text({
      name: 'Login URL',
      defaultValue: '/login?next=/admin/talent-applications',
    }),
  },
})
