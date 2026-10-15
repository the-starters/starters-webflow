import { declareComponent } from '@webflow/react'
import { StaffConsole } from './StaffConsole'

export default declareComponent(StaffConsole, {
  name: 'Staff Console',
  description: 'Staff-only Starter lookup and remove/restore. Xano checks staff access on every call.',
  group: 'Admin',
})
