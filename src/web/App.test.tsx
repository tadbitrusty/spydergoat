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
  it('renders the complete free-only product surface without payment links', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: /external time reference/i })).toBeInTheDocument();
    expect(screen.getAllByText(/browser preview/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/browser-derived preview/i)).toBeInTheDocument();
    expect(screen.queryByText(/server-derived today/i)).not.toBeInTheDocument();
    expect(document.querySelector('.code-window pre')?.textContent).toContain('"source": "server"');
    expect(document.querySelector('.code-window pre')?.textContent).not.toContain('"source": "browser"');
    expect(screen.getByRole('heading', { name: /time as one comparable number/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /where a shared reference helps/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /whole public api/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /paid access paused/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /buy|get api key|subscribe/i })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
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

  it('fails gracefully when calibration is rate-limited or unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole('button', { name: /calibrate/i }));

    expect(await screen.findByText(/calibration unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeEnabled();
  });
});
