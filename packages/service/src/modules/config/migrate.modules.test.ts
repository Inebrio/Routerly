import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRead, mockWrite } = vi.hoisted(() => ({ mockRead: vi.fn(), mockWrite: vi.fn() }))
vi.mock('./loader.js', () => ({ readConfig: mockRead, writeConfig: mockWrite }))

import { reenableModules } from './migrate.js'

describe('reenableModules', () => {
  beforeEach(() => { mockRead.mockReset(); mockWrite.mockReset() })

  it('clears disabled records and returns their ids', async () => {
    mockRead.mockResolvedValue([{ id: 'provider-web', enabled: false }, { id: 'cache', enabled: true }])
    expect(await reenableModules()).toEqual(['provider-web'])
    expect(mockWrite).toHaveBeenCalledWith('modules', [])
  })

  it('is a no-op when nothing is disabled', async () => {
    mockRead.mockResolvedValue([])
    expect(await reenableModules()).toEqual([])
    expect(mockWrite).not.toHaveBeenCalled()
  })
})
