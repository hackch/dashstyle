# Dashstyle

Dashstyle is a client-only, installable GPS speedometer with interchangeable
analog dashboards. GPS coordinates and speed remain in the browser; the app
makes no API requests and does not save ride history.

## Run

Serve this directory from `localhost` or an HTTPS origin, then open the page.
Location access requires a secure context and permission from the rider. For
example, with Python installed:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. On supported browsers, use the browser's install
command to add Dashstyle to the home screen. The service worker caches the
static app shell for offline use; a GPS signal is still required for live speed.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` publishes the static app
when changes are pushed to `main`, or when the workflow is run manually. In the
repository settings, open **Pages** and set the build and deployment source to
**GitHub Actions**. After the first successful workflow run, GitHub Pages shows
the published URL in that workflow's deployment.

## Dashboard settings

Use the settings button beside Start/Stop to choose a dashboard and shared scale.
Choose km/h or mph in the settings. The maximum speed applies to every style and
can be set in 10-unit increments using the native numeric input (100–320 km/h or
60–200 mph). The selected unit controls the speed readout, dial markings, and
scale. Each dashboard's appearance and needle shape are defined in `styles.json`.

The selected style and speed scale are stored locally in browser storage. Speed
uses the GPS-provided speed where available, otherwise derived from successive
accurate GPS fixes.

When GPS is started, Dashstyle requests device-orientation access where the
browser requires permission and uses the resulting tilt for a small visual
parallax effect. If the sensor is unsupported, denied, or reduced motion is
enabled, the dial remains centered and fully usable.
