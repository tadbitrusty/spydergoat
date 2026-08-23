import { StrictMode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const response = {
  mjd: 61262.5,
  utc: '2026-08-10T12:00:00.000Z',
  unix: 1786363200,
  source: 'server',
};

afterEach(() => {
  cleanup();
  document.getElementById('spydergoat-bootstrap')?.remove();
  vi.unstubAllGlobals();
});

describe('SpyderGoat v1.1', () => {
  it('renders the live Pro checkout surface without exposing a vendor URL', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    const brandLogo = screen.getByRole('link', { name: /spydergoat home/i }).querySelector('img');
    expect(brandLogo).toHaveAttribute('src', '/spydergoat-original.png');
    expect(brandLogo).toHaveAttribute('width', '40');
    expect(brandLogo).toHaveAttribute('height', '40');
    expect(screen.getByRole('heading', { level: 1, name: /timestamp receipts for software events/i })).toBeInTheDocument();
    expect(screen.getByText(/when logs, agents, webhooks, or databases disagree/i)).toBeInTheDocument();
    const heroFreeAction = screen.getByRole('link', { name: /^try free endpoint$/i });
    const heroProAction = screen.getByRole('button', { name: /^get pro · \$4\.89\/mo$/i });
    expect(heroFreeAction).toHaveTextContent(/^Try free endpoint$/i);
    expect(heroProAction).toHaveTextContent(/^Get Pro · \$4\.89\/mo$/i);
    expect(heroFreeAction).not.toHaveAttribute('aria-label');
    expect(heroProAction).not.toHaveAttribute('aria-label');
    expect(heroFreeAction).toHaveAttribute('href', '/mjd');
    expect(heroProAction.closest('form')).toHaveAttribute('action', '/checkout/pro');
    expect(heroProAction.compareDocumentPosition(screen.getByRole('region', { name: /current time receipt/i })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText(/browser preview/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/browser-derived preview/i)).toBeInTheDocument();
    expect(screen.queryByText(/server-derived today/i)).not.toBeInTheDocument();
    expect(document.querySelector('.code-window pre')?.textContent).toContain('"source": "server"');
    expect(document.querySelector('.code-window pre')?.textContent).not.toContain('"source": "browser"');
    expect(screen.getByRole('heading', { name: /time as one comparable number/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /where a shared reference helps/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /whole public api/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /pro access live/i })).toBeInTheDocument();
    const checkoutButton = screen.getByRole('button', { name: /^get pro$/i });
    expect(checkoutButton.closest('form')).toHaveAttribute('action', '/checkout/pro');
    expect(checkoutButton.closest('form')).toHaveAttribute('method', 'post');
    expect(document.querySelector('a[href*="stripe"]')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('links every technical guide and reference from a semantic discovery group', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<App />);

    const navigation = screen.getByRole('navigation', { name: /technical guides and references/i });
    const expectedLinks = [
      ['/reference/server-time-api', /server time api reference/i],
      ['/guides/current-timestamp', /get the current timestamp/i],
      ['/problems/untrusted-client-time', /untrusted client time/i],
      ['/problems/server-clock-drift', /server clock disagreement/i],
      ['/comparisons/client-time-vs-server-time', /client time versus server time/i],
      ['/reference/limits-and-non-guarantees', /limits and non-guarantees/i],
    ] as const;
    expect(navigation.querySelector('ul')).not.toBeNull();
    for (const [href, name] of expectedLinks) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
    expect(screen.queryByRole('link', { name: /compare server clock drift/i })).not.toBeInTheDocument();
  });

  it('posts the Pro action to the first-party Checkout route and reports failure safely', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'checkout_unavailable' }) });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole('button', { name: /^get pro$/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/checkout/pro', {
      method: 'POST', headers: { Accept: 'application/json' },
    });
    expect(await screen.findByText(/checkout is temporarily unavailable/i)).toBeInTheDocument();
  });

  it('uses a valid Worker bootstrap without spending a free API request', () => {
    const bootstrap = document.createElement('script');
    bootstrap.id = 'spydergoat-bootstrap';
    bootstrap.type = 'application/json';
    bootstrap.textContent = JSON.stringify(response);
    document.body.append(bootstrap);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(screen.getByText(/server anchored/i)).toBeInTheDocument();
    expect(screen.getByText(/server receipt loaded/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calibrates once on demand and reports the server receipt', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => response,
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole('button', { name: /calibrate/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/mjd', expect.objectContaining({ headers: { Accept: 'application/json' } }));
    expect(await screen.findByText(/calibrated from spydergoat/i)).toBeInTheDocument();
    expect(document.querySelector('time')?.getAttribute('datetime')).toMatch(/^2026-08-10T12:00:00\.\d{3}Z$/);
  });

  it('recovers from calibration failure under the development StrictMode root', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    const user = userEvent.setup();

    render(<StrictMode><App /></StrictMode>);
    await user.click(screen.getByRole('button', { name: /calibrate/i }));

    expect(await screen.findByText(/calibration unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeEnabled();
  });

  it('reports the retry window when calibration is rate-limited', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (name: string) => name === 'Retry-After' ? '1800' : null },
    }));
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole('button', { name: /calibrate/i }));

    expect(await screen.findByText(/rate limit reached.*30 minutes/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeEnabled();
  });
});
