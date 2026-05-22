/**
 * <frankenphp-prometheus-widget> — live FrankenPHP / Caddy / Go runtime
 * metrics widget for the TYPO3 Dashboard module.
 *
 * Reactive Lit properties (set as HTML attributes by the Fluid template):
 *   - metric   (attribute `metric`)    — metric family name picked in widget settings
 *   - ajaxUrl  (attribute `ajax-url`)  — backend AJAX route that proxies + parses /metrics
 */

import { LitElement, html } from 'lit';
import {
  Chart,
  LineController,
  BarController,
  LineElement,
  BarElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler,
  Legend,
  Tooltip,
} from 'chart.js';

Chart.register(
  LineController,
  BarController,
  LineElement,
  BarElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler,
  Legend,
  Tooltip,
);

const POLL_INTERVAL_MS = 5_000;
const SAMPLE_BUFFER_SIZE = 60;

const isHistogramFamily = (type) => type === 'histogram';
const isSummaryFamily = (type) => type === 'summary';

class MetricsPoller {
  #subscribers = new Map(); // ajaxUrl → Set<callback>
  #handles = new Map();     // ajaxUrl → intervalId
  #lastSnapshot = new Map();// ajaxUrl → snapshot object

  /**
   * Register a callback for an ajaxUrl. Returns an unsubscribe function.
   */
  subscribe(ajaxUrl, callback) {
    if (!this.#subscribers.has(ajaxUrl)) {
      this.#subscribers.set(ajaxUrl, new Set());
    }
    this.#subscribers.get(ajaxUrl).add(callback);

    // Immediate hand-off of the cached snapshot — keeps newly mounted
    // widgets from showing an empty chart for up to POLL_INTERVAL_MS.
    const cached = this.#lastSnapshot.get(ajaxUrl);
    if (cached) {
      callback(cached);
    }

    // Lazy start of the polling loop for this URL.
    if (!this.#handles.has(ajaxUrl)) {
      this.#poll(ajaxUrl);
      this.#handles.set(
        ajaxUrl,
        setInterval(() => this.#poll(ajaxUrl), POLL_INTERVAL_MS),
      );
    }

    return () => this.#unsubscribe(ajaxUrl, callback);
  }

  #unsubscribe(ajaxUrl, callback) {
    const subs = this.#subscribers.get(ajaxUrl);
    if (!subs) return;
    subs.delete(callback);
    if (subs.size === 0) {
      // Last subscriber gone — stop polling, drop state.
      const handle = this.#handles.get(ajaxUrl);
      if (handle) {
        clearInterval(handle);
      }
      this.#handles.delete(ajaxUrl);
      this.#subscribers.delete(ajaxUrl);
      this.#lastSnapshot.delete(ajaxUrl);
    }
  }

  async #poll(ajaxUrl) {
    let snapshot;
    try {
      const res = await fetch(ajaxUrl, { credentials: 'same-origin' });
      const payload = await res.json();
      if (!res.ok) {
        const msg = payload.error
          ? `${payload.error}${payload.hint ? ' — ' + payload.hint : ''}`
          : `Metrics endpoint returned HTTP ${res.status}`;
        snapshot = { ok: false, status: res.status, payload, error: msg };
      } else {
        snapshot = { ok: true, status: res.status, payload, error: null };
      }
    } catch (err) {
      snapshot = { ok: false, status: 0, payload: null, error: `Failed to scrape metrics: ${err.message}` };
    }

    this.#lastSnapshot.set(ajaxUrl, snapshot);
    // Iterate over a snapshot of the subscriber set so that callbacks
    // unsubscribing mid-iteration don't trip the Set's mutation guard.
    const subs = this.#subscribers.get(ajaxUrl);
    if (!subs) return;
    for (const callback of Array.from(subs)) {
      try {
        callback(snapshot);
      } catch (err) {
        // A misbehaving subscriber must not stop us from notifying the
        // others — log and carry on.
        // eslint-disable-next-line no-console
        console.error('frankenphp-prometheus-widget subscriber threw:', err);
      }
    }
  }
}

const sharedPoller = new MetricsPoller();

class FrankenPhpPrometheusWidget extends LitElement {
  static properties = {
    // Public reactive properties — populated from HTML attributes by Lit
    // before connectedCallback fires. The Fluid template sets them as
    // `metric="…" ajax-url="…"` on the host element.
    metric:  { type: String },
    ajaxUrl: { type: String, attribute: 'ajax-url' },

    // Internal reactive state. Mutations trigger render() automatically.
    // Prefixed with _ for the conventional "internal, please don't touch
    // from outside" signal; the `state: true` config keeps them out of
    // the host element's attribute map (so they don't reflect back to
    // the DOM).
    _metricType: { state: true },
    _error:      { state: true },
  };

  // Non-reactive instance state. Polling lives on `sharedPoller`; the
  // widget only owns its own buffer + chart + unsubscribe handle.
  #buffer = [];     // [{ t: Date, value: number, perQuantile?: {q: value}, buckets?: [{le, value}] }]
  #chart = null;    // Chart.js instance, owned by updated()
  #unsubscribe = null; // function returned by sharedPoller.subscribe()

  // Opt out of shadow DOM so the TYPO3 backend stylesheet (Bootstrap 5
  // utilities, `.alert` / `.badge` / `.callout` variants, dashboard
  // chrome) cascades into the rendered content. With shadow DOM the
  // widget body would be visually isolated, forcing us to re-declare
  // every TYPO3 design token here; light DOM keeps it consistent with
  // the rest of the dashboard for free.
  //
  // Lit ignores `static styles` when createRenderRoot() returns `this`,
  // so all visual rules live in
  // Resources/Public/Css/widget/prometheus-metrics.css instead.
  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    // Property defaults. Lit reads HTML attributes after construction
    // but before connectedCallback, so these get overwritten when the
    // host element ships `metric="…" ajax-url="…"` in the markup.
    this.metric = '';
    this.ajaxUrl = '';
    this._metricType = null;
    this._error = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.#subscribeToPoller();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#unsubscribeFromPoller();
    if (this.#chart) {
      this.#chart.destroy();
      this.#chart = null;
    }
  }

  willUpdate(changed) {
    if (changed.has('metric') || changed.has('ajaxUrl')) {
      this.#buffer = [];
      this._metricType = null;
      this._error = null;
      if (this.isConnected) {
        this.#subscribeToPoller();
      }
    }
  }

  #subscribeToPoller() {
    this.#unsubscribeFromPoller();
    if (!this.metric || !this.ajaxUrl) {
      this._error = 'Widget is not configured. Open the widget settings and pick a metric.';
      return;
    }
    this.#unsubscribe = sharedPoller.subscribe(this.ajaxUrl, (snapshot) => this.#onScrape(snapshot));
  }

  #unsubscribeFromPoller() {
    if (this.#unsubscribe) {
      this.#unsubscribe();
      this.#unsubscribe = null;
    }
  }

  /**
   * Called by sharedPoller after every successful or failed fetch.
   * snapshot shape: { ok, status, payload, error }
   */
  #onScrape(snapshot) {
    if (!snapshot.ok) {
      this._error = snapshot.error;
      return;
    }

    const family = snapshot.payload.metrics?.[this.metric];
    if (!family) {
      this._error = `Metric "${this.metric}" is not exposed at the endpoint. Open the widget settings and pick a different metric.`;
      return;
    }

    this._error = null;
    this._metricType = family.type;
    this.#ingestSamples(family);
    // Buffer mutations are not reactive; ping Lit so the next render
    // picks up the new data.
    this.requestUpdate();
  }

  #ingestSamples(family) {
    const ts = new Date();
    if (isHistogramFamily(family.type)) {
      // Histograms render the latest scrape only — bucket distribution
      // is a per-scrape view, not a time series.
      this.#buffer = [{ t: ts, buckets: this.#extractBuckets(family.samples) }];
      return;
    }
    if (isSummaryFamily(family.type)) {
      this.#appendSample({ t: ts, perQuantile: this.#extractQuantiles(family.samples) });
      return;
    }
    // counter / gauge: take the first sample's value (most metrics have
    // exactly one — multi-label series collapse to the first for v1).
    const value = family.samples?.[0]?.value ?? null;
    this.#appendSample({ t: ts, value });
  }

  #appendSample(sample) {
    this.#buffer.push(sample);
    while (this.#buffer.length > SAMPLE_BUFFER_SIZE) {
      this.#buffer.shift();
    }
  }

  #extractBuckets(samples) {
    // Filter to samples that have the `le` label (bucket boundary) and
    // sort by numeric value of le. "+Inf" sorts last.
    return samples
      .filter((s) => s.labels && Object.prototype.hasOwnProperty.call(s.labels, 'le'))
      .map((s) => ({ le: s.labels.le, value: s.value }))
      .sort((a, b) => this.#leAsNumber(a.le) - this.#leAsNumber(b.le));
  }

  #leAsNumber(le) {
    if (le === '+Inf' || le === 'Inf') return Number.POSITIVE_INFINITY;
    const n = parseFloat(le);
    return Number.isNaN(n) ? 0 : n;
  }

  #extractQuantiles(samples) {
    // Summary samples carry a `quantile` label (0.5, 0.9, 0.99, …).
    const out = {};
    for (const sample of samples) {
      if (sample.labels && sample.labels.quantile !== undefined) {
        out[sample.labels.quantile] = sample.value;
      }
    }
    return out;
  }

  render() {
    if (this._error) {
      return html`
        <div class="d-flex flex-column h-100 gap-2">
          <div class="d-flex justify-content-end">
            ${this._metricType ? html`<span class="badge text-lowercase">${this._metricType}</span>` : ''}
          </div>
          <div class="alert alert-warning mb-0">${this._error}</div>
        </div>
      `;
    }
    return html`
      <div class="d-flex flex-column h-100 gap-2">
        <div class="d-flex justify-content-end">
          <span class="badge text-lowercase">${this._metricType || '…'}</span>
        </div>
        <div class="frankenphp-prometheus-chart-wrap">
          <canvas></canvas>
        </div>
      </div>
    `;
  }

  updated() {
    if (this._error) {
      // Tear down the chart if a previously healthy widget transitioned
      // into an error state — the canvas isn't in the DOM anymore.
      if (this.#chart) {
        this.#chart.destroy();
        this.#chart = null;
      }
      return;
    }
    const canvas = this.renderRoot.querySelector('canvas');
    if (!canvas) return;
    if (!this.#chart) {
      this.#chart = this.#buildChart(canvas);
    } else {
      this.#refreshChartData();
      this.#chart.update('none');
    }
  }

  #buildChart(canvas) {
    const ctx = canvas.getContext('2d');
    return new Chart(ctx, this.#chartConfig());
  }

  #chartConfig() {
    if (isHistogramFamily(this._metricType)) {
      const buckets = this.#buffer[0]?.buckets ?? [];
      return {
        type: 'bar',
        data: {
          labels: buckets.map((b) => `le=${b.le}`),
          datasets: [{
            label: this.metric,
            data: buckets.map((b) => b.value),
            backgroundColor: 'rgba(255, 135, 0, 0.4)',
            borderColor: '#ff8700',
            borderWidth: 1,
          }],
        },
        options: this.#commonChartOptions(),
      };
    }
    if (isSummaryFamily(this._metricType)) {
      const quantileNames = this.#collectQuantileNames();
      return {
        type: 'line',
        data: {
          labels: this.#buffer.map((s) => s.t.toLocaleTimeString()),
          datasets: quantileNames.map((q, idx) => ({
            label: `p${Math.round(parseFloat(q) * 100)}`,
            data: this.#buffer.map((s) => s.perQuantile?.[q] ?? null),
            borderColor: this.#color(idx),
            backgroundColor: this.#color(idx, 0.15),
            tension: 0.2,
            spanGaps: true,
          })),
        },
        options: this.#commonChartOptions(),
      };
    }
    // counter / gauge — single dataset of value over time.
    return {
      type: 'line',
      data: {
        labels: this.#buffer.map((s) => s.t.toLocaleTimeString()),
        datasets: [{
          label: this.metric,
          data: this.#buffer.map((s) => s.value),
          borderColor: '#ff8700',
          backgroundColor: 'rgba(255, 135, 0, 0.15)',
          tension: 0.2,
          fill: true,
        }],
      },
      options: this.#commonChartOptions(),
    };
  }

  #refreshChartData() {
    // Rebuild the data block in place so the live chart picks up new
    // samples without a full chart recreation. type can also change if
    // the user switches metrics — handle that by destroying and
    // rebuilding.
    const cfg = this.#chartConfig();
    if (this.#chart.config.type !== cfg.type) {
      this.#chart.destroy();
      this.#chart = this.#buildChart(this.renderRoot.querySelector('canvas'));
      return;
    }
    this.#chart.data = cfg.data;
  }

  #commonChartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      plugins: {
        legend: { display: isSummaryFamily(this._metricType) },
        tooltip: { enabled: true },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 6 } },
        y: { beginAtZero: !isSummaryFamily(this._metricType) },
      },
    };
  }

  #collectQuantileNames() {
    const set = new Set();
    for (const sample of this.#buffer) {
      if (sample.perQuantile) {
        for (const q of Object.keys(sample.perQuantile)) set.add(q);
      }
    }
    return Array.from(set).sort((a, b) => parseFloat(a) - parseFloat(b));
  }

  #color(idx, alpha = 1) {
    const palette = [
      [255, 135, 0],   // TYPO3 orange
      [80, 145, 255],
      [120, 200, 90],
      [220, 70, 130],
      [130, 80, 200],
    ];
    const rgb = palette[idx % palette.length];
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  }
}

if (!customElements.get('frankenphp-prometheus-widget')) {
  customElements.define('frankenphp-prometheus-widget', FrankenPhpPrometheusWidget);
}
