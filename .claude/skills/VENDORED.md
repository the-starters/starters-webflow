# Vendored skills — mattpocock/skills

The following skill directories are vendored from
https://github.com/mattpocock/skills (MIT License, © 2026 Matt Pocock),
snapshot at commit `8b36d4f` (plugin `mattpocock-skills` v1.2.2):

## Engineering

- `ask-matt`
- `code-review`
- `codebase-design`
- `diagnosing-bugs`
- `domain-modeling`
- `grill-with-docs`
- `implement`
- `improve-codebase-architecture`
- `prototype`
- `research`
- `resolving-merge-conflicts`
- `setup-matt-pocock-skills`
- `tdd`
- `to-spec`
- `to-tickets`
- `triage`
- `wayfinder`
- `wizard`

## Productivity

- `grill-me`
- `grilling`
- `handoff`
- `teach`
- `to-questionnaire`
- `wait-what`
- `writing-for-agents`

Vendored because the marketplace plugin declared in `.claude/settings.json`
does not load its skills in Claude Code web/remote sessions or Cursor Cloud
Agents (the cloud plugin manifest records `mattpocock-skills` with an empty
skill list). Project skills under `.claude/skills/` do load.

This is the full shipped set from `.claude-plugin/plugin.json`. Upstream
`skills/in-progress/*` and `skills/misc/*` are not vendored.

To update, re-copy each shipped skill directory from the upstream repo into
`.claude/skills/<skill-name>/`.

`webflow-attr-migration-debug` is a local team skill, not from this snapshot.

## Upstream license

    MIT License
    
    Copyright (c) 2026 Matt Pocock
    
    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:
    
    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.
    
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
