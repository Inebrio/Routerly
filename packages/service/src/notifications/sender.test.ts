import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockSendMail } = vi.hoisted(() => {
  const mockSendMail = vi.fn()
  return { mockSendMail }
})

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
  },
}))

vi.mock('./channels/slack.js',     () => ({ sendSlack: vi.fn() }))
vi.mock('./channels/teams.js',     () => ({ sendTeams: vi.fn() }))
vi.mock('./channels/pagerduty.js', () => ({ sendPagerDuty: vi.fn() }))
vi.mock('./channels/discord.js',   () => ({ sendDiscord: vi.fn() }))

import { sendTestNotification, dispatchNotification } from './sender.js'

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('sendTestNotification', () => {
  describe('SMTP channel', () => {
    const smtpChannel: any = {
      provider: 'smtp',
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      fromAddress: 'noreply@example.com',
      fromName: 'Routerly',
    }

    it('sends test email and returns ok', async () => {
      mockSendMail.mockResolvedValue({ messageId: '123' })
      const result = await sendTestNotification(smtpChannel, 'user@example.com')
      expect(result.ok).toBe(true)
      expect(result.message).toContain('SMTP')
      expect(mockSendMail).toHaveBeenCalled()
    })

    it('passes fromName in from field', async () => {
      mockSendMail.mockResolvedValue({})
      await sendTestNotification(smtpChannel, 'user@example.com')
      const mail = mockSendMail.mock.calls[0]![0]
      expect(mail.from).toContain('Routerly')
      expect(mail.from).toContain('noreply@example.com')
    })

    it('auto-corrects TLS on ssl3_get_record error', async () => {
      mockSendMail
        .mockRejectedValueOnce(new Error('ssl3_get_record'))
        .mockResolvedValueOnce({})
      const result = await sendTestNotification(smtpChannel, 'user@example.com')
      expect(result.ok).toBe(true)
      expect(result.fixedSecure).toBeDefined()
    })

    it('auto-corrects TLS on wrong version number error', async () => {
      mockSendMail
        .mockRejectedValueOnce(new Error('wrong version number'))
        .mockResolvedValueOnce({})
      const result = await sendTestNotification(smtpChannel, 'user@example.com')
      expect(result.ok).toBe(true)
    })

    it('auto-corrects TLS on ECONNRESET error', async () => {
      mockSendMail
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({})
      const result = await sendTestNotification(smtpChannel, 'u@x.com')
      expect(result.ok).toBe(true)
    })

    it('throws when both TLS and non-TLS fail', async () => {
      mockSendMail
        .mockRejectedValueOnce(new Error('ssl3_get_record'))
        .mockRejectedValueOnce(new Error('connection refused'))
      await expect(sendTestNotification(smtpChannel, 'u@x.com')).rejects.toThrow('smtp.example.com:587')
    })

    it('rethrows non-SSL errors immediately', async () => {
      mockSendMail.mockRejectedValue(new Error('auth failed'))
      await expect(sendTestNotification(smtpChannel, 'u@x.com')).rejects.toThrow('auth failed')
    })

    it('omits fromName when not provided', async () => {
      mockSendMail.mockResolvedValue({})
      const noName = { ...smtpChannel, fromName: undefined }
      await sendTestNotification(noName, 'to@x.com')
      const mail = mockSendMail.mock.calls[0]![0]
      expect(mail.from).toBe('noreply@example.com')
    })

    it('includes auth when username is set', async () => {
      mockSendMail.mockResolvedValue({})
      const withAuth = { ...smtpChannel, username: 'user', password: 'pass' }
      await sendTestNotification(withAuth, 'to@x.com')
      expect(mockSendMail).toHaveBeenCalled()
    })

    it('uses empty string for password when username is set but password is omitted', async () => {
      mockSendMail.mockResolvedValue({})
      const withUsernameOnly = { ...smtpChannel, username: 'user' }
      await sendTestNotification(withUsernameOnly, 'to@x.com')
      expect(mockSendMail).toHaveBeenCalled()
    })

    it('rethrows non-Error thrown values (string) that are not SSL errors', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockSendMail.mockRejectedValue('string error value' as any)
      await expect(sendTestNotification(smtpChannel, 'u@x.com')).rejects.toBe('string error value')
    })

    it('returns disable-TLS hint when cfg.secure=true and flip to false succeeds', async () => {
      mockSendMail
        .mockRejectedValueOnce(new Error('ssl3_get_record'))
        .mockResolvedValueOnce({})
      const secureChannel = { ...smtpChannel, secure: true }
      const result = await sendTestNotification(secureChannel, 'u@x.com')
      expect(result.ok).toBe(true)
      expect(result.fixedSecure).toBe(false)
      expect(result.message).toContain('disable')
    })
  })

  describe('SES channel', () => {
    it('sends via Amazon SES and returns ok', async () => {
      mockSendMail.mockResolvedValue({})
      const result = await sendTestNotification({
        provider: 'ses', region: 'us-east-1',
        accessKeyId: 'AKIA...', secretAccessKey: 'secret',
        fromAddress: 'noreply@example.com',
      } as any, 'user@example.com')
      expect(result.ok).toBe(true)
      expect(result.message).toContain('Amazon SES')
    })

    it('sends without auth when accessKeyId is not set', async () => {
      mockSendMail.mockResolvedValue({})
      const result = await sendTestNotification({
        provider: 'ses', region: 'us-east-1',
        fromAddress: 'noreply@example.com',
      } as any, 'user@example.com')
      expect(result.ok).toBe(true)
    })

    it('uses empty string password when secretAccessKey is absent (line 71 ?? branch)', async () => {
      mockSendMail.mockResolvedValue({})
      await sendTestNotification({
        provider: 'ses', region: 'us-east-1',
        accessKeyId: 'AKIA...', // secretAccessKey intentionally absent → ?? ''
        fromAddress: 'noreply@example.com',
      } as any, 'user@example.com')
      expect(mockSendMail).toHaveBeenCalled()
    })

    it('uses raw fromAddress when fromName is not set', async () => {
      mockSendMail.mockResolvedValue({})
      await sendTestNotification({
        provider: 'ses', region: 'us-east-1',
        accessKeyId: 'AKIA...', secretAccessKey: 'secret',
        fromAddress: 'noreply@example.com',
      } as any, 'user@example.com')
      const mail = mockSendMail.mock.calls[0]![0]
      expect(mail.from).toBe('noreply@example.com')
    })

    it('formats from field with fromName when set', async () => {
      mockSendMail.mockResolvedValue({})
      await sendTestNotification({
        provider: 'ses', region: 'us-east-1',
        accessKeyId: 'AKIA...', secretAccessKey: 'secret',
        fromAddress: 'noreply@example.com', fromName: 'Routerly',
      } as any, 'user@example.com')
      const mail = mockSendMail.mock.calls[0]![0]
      expect(mail.from).toContain('Routerly')
    })
  })

  describe('SendGrid channel', () => {
    it('sends via SendGrid and returns ok', async () => {
      mockSendMail.mockResolvedValue({})
      const result = await sendTestNotification({
        provider: 'sendgrid', apiKey: 'SG.test', fromAddress: 'noreply@example.com',
      } as any, 'user@example.com')
      expect(result.ok).toBe(true)
      expect(result.message).toContain('SendGrid')
    })

    it('includes fromName when set', async () => {
      mockSendMail.mockResolvedValue({})
      await sendTestNotification({
        provider: 'sendgrid', apiKey: 'SG.test',
        fromAddress: 'noreply@example.com', fromName: 'My App',
      } as any, 'u@x.com')
      const mail = mockSendMail.mock.calls[0]![0]
      expect(mail.from).toContain('My App')
    })
  })

  describe('Google channel', () => {
    it('sends via Google OAuth2 and returns ok', async () => {
      mockSendMail.mockResolvedValue({})
      const result = await sendTestNotification({
        provider: 'google', fromAddress: 'noreply@gmail.com',
        clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken',
      } as any, 'user@example.com')
      expect(result.ok).toBe(true)
      expect(result.message).toContain('Google')
    })

    it('uses raw fromAddress when fromName is not set', async () => {
      mockSendMail.mockResolvedValue({})
      await sendTestNotification({
        provider: 'google', fromAddress: 'noreply@gmail.com',
        clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken',
      } as any, 'user@example.com')
      const mail = mockSendMail.mock.calls[0]![0]
      expect(mail.from).toBe('noreply@gmail.com')
    })

    it('formats from field with fromName when set (line 154 true branch)', async () => {
      mockSendMail.mockResolvedValue({})
      await sendTestNotification({
        provider: 'google', fromAddress: 'noreply@gmail.com',
        clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken',
        fromName: 'My App',
      } as any, 'user@example.com')
      const mail = mockSendMail.mock.calls[0]![0]
      expect(mail.from).toContain('My App')
      expect(mail.from).toContain('noreply@gmail.com')
    })
  })

  describe('Azure channel', () => {
    const azureChannel: any = {
      provider: 'azure',
      connectionString: 'endpoint=https://test.communication.azure.com;accesskey=dGVzdGtleQ==',
      fromAddress: 'noreply@test.com',
    }

    it('returns ok when Azure API responds successfully', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 202 }))
      const result = await sendTestNotification(azureChannel, 'user@example.com')
      expect(result.ok).toBe(true)
      expect(result.message).toContain('Azure')
    })

    it('throws when Azure API returns error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false, status: 400, text: async () => 'Bad Request',
      }))
      await expect(sendTestNotification(azureChannel, 'user@example.com')).rejects.toThrow('400')
    })

    it('throws for invalid connection string', async () => {
      await expect(sendTestNotification({
        ...azureChannel, connectionString: 'invalid',
      }, 'u@x.com')).rejects.toThrow('Invalid Azure connection string')
    })

    it('throws when endpoint is missing from connection string', async () => {
      await expect(sendTestNotification({
        ...azureChannel, connectionString: 'accesskey=dGVzdA==',
      }, 'u@x.com')).rejects.toThrow('Invalid Azure connection string')
    })

    it('sends request with HMAC Authorization header', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 202 })
      vi.stubGlobal('fetch', mockFetch)
      await sendTestNotification(azureChannel, 'user@example.com')
      const headers = mockFetch.mock.calls[0]![1].headers
      expect(headers['Authorization']).toContain('HMAC-SHA256')
    })
  })

  describe('Webhook channel', () => {
    it('sends POST and returns ok', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
      const result = await sendTestNotification({
        provider: 'webhook', url: 'https://hooks.example.com/incoming',
      } as any, 'any')
      expect(result.ok).toBe(true)
      expect(result.message).toContain('200')
    })

    it('sends HMAC signature when secret is set', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
      vi.stubGlobal('fetch', mockFetch)
      await sendTestNotification({
        provider: 'webhook', url: 'https://hooks.example.com/hook', secret: 'mysecret',
      } as any, 'any')
      const headers = mockFetch.mock.calls[0]![1].headers
      expect(headers['X-Routerly-Signature']).toMatch(/^sha256=/)
    })

    it('uses GET method when specified', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
      vi.stubGlobal('fetch', mockFetch)
      await sendTestNotification({
        provider: 'webhook', url: 'https://hooks.example.com/hook', method: 'GET',
      } as any, 'any')
      expect(mockFetch.mock.calls[0]![1].method).toBe('GET')
    })

    it('throws when server responds with non-ok status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false, status: 500, text: async () => 'Server Error',
      }))
      await expect(sendTestNotification({
        provider: 'webhook', url: 'https://hooks.example.com/hook',
      } as any, 'any')).rejects.toThrow('HTTP 500')
    })

    it('rejects localhost', async () => {
      await expect(sendTestNotification({
        provider: 'webhook', url: 'http://localhost:9000/hook',
      } as any, 'any')).rejects.toThrow('private or loopback')
    })

    it('rejects 192.168.x.x', async () => {
      await expect(sendTestNotification({
        provider: 'webhook', url: 'http://192.168.1.1/hook',
      } as any, 'any')).rejects.toThrow('private or loopback')
    })

    it('rejects 172.16.x.x private range', async () => {
      await expect(sendTestNotification({
        provider: 'webhook', url: 'http://172.16.0.1/hook',
      } as any, 'any')).rejects.toThrow('private or loopback')
    })

    it('rejects 10.x.x.x', async () => {
      await expect(sendTestNotification({
        provider: 'webhook', url: 'http://10.0.0.1/hook',
      } as any, 'any')).rejects.toThrow('private or loopback')
    })

    it('rejects 127.x.x.x loopback', async () => {
      await expect(sendTestNotification({
        provider: 'webhook', url: 'http://127.0.0.1/hook',
      } as any, 'any')).rejects.toThrow('private or loopback')
    })

    it('rejects ::1 IPv6 loopback', async () => {
      await expect(sendTestNotification({
        provider: 'webhook', url: 'http://[::1]/hook',
      } as any, 'any')).rejects.toThrow('private or loopback')
    })

    it('rejects link-local 169.254.x.x', async () => {
      await expect(sendTestNotification({
        provider: 'webhook', url: 'http://169.254.1.1/hook',
      } as any, 'any')).rejects.toThrow('private or loopback')
    })

    it('rejects invalid URL', async () => {
      await expect(sendTestNotification({
        provider: 'webhook', url: 'not-a-url',
      } as any, 'any')).rejects.toThrow('Invalid webhook URL')
    })

    it('rejects ftp:// protocol', async () => {
      await expect(sendTestNotification({
        provider: 'webhook', url: 'ftp://example.com/hook',
      } as any, 'any')).rejects.toThrow('http or https')
    })

    it('rejects IPv6 ULA address (fc00::)', async () => {
      await expect(sendTestNotification({
        provider: 'webhook', url: 'http://[fc00::1]/hook',
      } as any, 'any')).rejects.toThrow('private or loopback')
    })

    it('rejects IPv6 ULA address (fd00::)', async () => {
      await expect(sendTestNotification({
        provider: 'webhook', url: 'http://[fd12:3456:789a:1::1]/hook',
      } as any, 'any')).rejects.toThrow('private or loopback')
    })

    it('rejects IPv6 link-local address (fe80::)', async () => {
      await expect(sendTestNotification({
        provider: 'webhook', url: 'http://[fe80::1]/hook',
      } as any, 'any')).rejects.toThrow('private or loopback')
    })

    it('rejects AWS cloud metadata address 169.254.170.2', async () => {
      await expect(sendTestNotification({
        provider: 'webhook', url: 'http://169.254.170.2/hook',
      } as any, 'any')).rejects.toThrow('private or loopback')
    })

    it('rejects Alibaba cloud metadata address 100.100.100.200', async () => {
      await expect(sendTestNotification({
        provider: 'webhook', url: 'http://100.100.100.200/hook',
      } as any, 'any')).rejects.toThrow('private or loopback')
    })
  })

  it('throws for unknown provider', async () => {
    await expect(sendTestNotification({ provider: 'unknown' } as any, 'x@y.com')).rejects.toThrow('Unknown provider')
  })

  it('slack test returns ok', async () => {
    const r = await sendTestNotification({ provider: 'slack', botToken: 't', channelId: 'c' } as any, '')
    expect(r.message).toContain('Slack')
  })
  it('teams test returns ok', async () => {
    const r = await sendTestNotification({ provider: 'teams', webhookUrl: 'https://x' } as any, '')
    expect(r.message).toContain('Teams')
  })
  it('pagerduty test returns ok', async () => {
    const r = await sendTestNotification({ provider: 'pagerduty', integrationKey: 'k' } as any, '')
    expect(r.message).toContain('PagerDuty')
  })
  it('discord test returns ok', async () => {
    const r = await sendTestNotification({ provider: 'discord', webhookUrl: 'https://x' } as any, '')
    expect(r.message).toContain('Discord')
  })

  it('dashboard channel test returns ok with inbox note', async () => {
    const result = await sendTestNotification({ provider: 'dashboard', id: 'd' } as any, '')
    expect(result.ok).toBe(true)
    expect(result.message).toContain('inbox')
  })
})

describe('dispatchNotification recipients (U5)', () => {
  const payload = { event: 'provider.error', severity: 'critical', timestamp: 't', details: {} }
  const smtp: any = { provider: 'smtp', host: 'h', port: 587, secure: false, fromAddress: 'sys@x' }

  it('emails the resolved recipients (comma-joined) when provided', async () => {
    mockSendMail.mockResolvedValue({})
    await dispatchNotification(smtp, payload, ['a@x', 'b@x'])
    expect(mockSendMail.mock.calls[0]![0].to).toBe('a@x, b@x')
  })

  it('falls back to fromAddress when recipients undefined', async () => {
    mockSendMail.mockResolvedValue({})
    await dispatchNotification(smtp, payload)
    expect(mockSendMail.mock.calls[0]![0].to).toBe('sys@x')
  })

  it('falls back to fromAddress when recipients empty', async () => {
    mockSendMail.mockResolvedValue({})
    await dispatchNotification(smtp, payload, [])
    expect(mockSendMail.mock.calls[0]![0].to).toBe('sys@x')
  })

  it('webhook delivery ignores recipients', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    const result = await dispatchNotification(
      { provider: 'webhook', url: 'https://hooks.example.com/h' } as any, payload, ['a@x'],
    )
    expect(result.ok).toBe(true)
  })

  it('dispatches via ses to resolved recipients', async () => {
    mockSendMail.mockResolvedValue({})
    await dispatchNotification({ provider: 'ses', region: 'us-east-1', fromAddress: 'sys@x' } as any, payload, ['r@x'])
    expect(mockSendMail.mock.calls[0]![0].to).toBe('r@x')
  })

  it('dispatches via sendgrid', async () => {
    mockSendMail.mockResolvedValue({})
    await dispatchNotification({ provider: 'sendgrid', apiKey: 'SG', fromAddress: 'sys@x' } as any, payload)
    expect(mockSendMail).toHaveBeenCalled()
  })

  it('dispatches via google', async () => {
    mockSendMail.mockResolvedValue({})
    await dispatchNotification({
      provider: 'google', fromAddress: 'sys@gmail.com', clientId: 'c', clientSecret: 's', refreshToken: 'r',
    } as any, payload)
    expect(mockSendMail).toHaveBeenCalled()
  })

  it('dispatches via azure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 202 }))
    const r = await dispatchNotification({
      provider: 'azure',
      connectionString: 'endpoint=https://t.communication.azure.com;accesskey=dGVzdGtleQ==',
      fromAddress: 'sys@x',
    } as any, payload)
    expect(r.ok).toBe(true)
  })

  it('throws for unknown provider', async () => {
    await expect(dispatchNotification({ provider: 'nope' } as any, payload)).rejects.toThrow('Unknown provider')
  })
})
