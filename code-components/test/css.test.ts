import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('scopes box sizing to the talent admin component', () => {
  const css = readFileSync(
    resolve(process.cwd(), 'src/TalentApplicationsAdmin.module.css'),
    'utf8',
  )
  expect(css).toContain('.shell, .shell * { box-sizing: border-box; }')
  expect(css).not.toContain(':global(*)')
})
