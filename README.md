# @globetrotte/altimeter - Altimeter

A simple cli for generating preview image of a given url(s) with [Playwright](https://playwright.dev/).

## Getting started

Create a simple config json file like below.

```json
{
  "baseURL": "https://gitnav.xyz",
  "dir": "doc/preview"
}
```

Name the file something like `config.json` then run it with altimeter.

```sh
> altimeter config.json
Generated doc/preview/base.jpg
```

Open up the `doc/preview` directory, aaand tadaa! there's an image called `base.jpg` that looks like this in there!

![Screenshot of gitnav.xyz Homepage](doc/preview/base.jpg)

The first run downloads the Playwright build of the configured browser (only the headless shell for Chromium) if it isn't installed yet. To use a browser that's already on the machine instead, set [`channel`](#channel) or [`executablePath`](#executablepath).

Altimeter exits with a non-zero code if the config is invalid or any screenshot fails, so it can be used in CI as-is. Pages that respond with an HTTP error status (eg. 404) count as failures.

## Config

Here's a list of things that can be set with the config file.

The config is validated before any browser is launched: invalid values are all reported together, and unknown keys (eg. a typo like `baseUrl`) produce a warning.

### **browser**

- Type: `BrowserTypes` (`"chromium" | "firefox" | "webkit"`)
- Default: `"chromium"`

Browser type to use for generating the screenshots.

### **channel**

- Type: `string` (eg. `"chrome"`, `"msedge"`)
- Default: `undefined`

Use an installed browser distribution instead of downloading the Playwright build. See [Playwright's docs](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge) for supported channels.

### **executablePath**

- Type: `string`
- Default: `undefined`

Path to a browser executable to use instead of downloading the Playwright build.

### **baseURL** (required)

- Type: `string` (eg. `"https://gitnav.xyz"`)
- Default: `undefined`

This is basically the base URL of the site you want to take screenshots of.

### **destURLs**

- Type: `AltimeterDestination[]` (eg. `{"name": "drag_and_drop_rebase", "url": "docs/drag-and-drop-rebase.html"}`)
- Default: `[]`

`name` field here is used for the name of the screenshot image. With the example of `"drag_and_drop_rebase"`, the image would be called `drag_and_drop_rebase.jpg`. `url` field here is the path on top of the `baseURL` field. With the example of `"docs/drag-and-drop-rebase.html"` (and `"https://gitnav.xyz"` as baseURL), it would then take the screenshot of `https://gitnav.xyz/docs/drag-and-drop-rebase.html`.

If this is empty, it would take a screenshot of the base url and save it as `base.jpg`.

### **dir**

- Type: `string`
- Default: `"altimeter"`

Directory where all the preview images should be saved to.

### **width**

- Type: `number`
- Default: `1200`

Width of the preview images.

### **height**

- Type: `number`
- Default: `600`

Height of the preview images.

### **waitUntil**

- Type: `"load" | "domcontentloaded" | "networkidle" | "commit"`
- Default: `"load"`

Which load state to wait for after navigating to a page. `"networkidle"` waits until there has been no network activity for 500ms, which may never happen on pages with analytics, chat widgets or polling.

### **waitForSelector**

- Type: `string` (eg. `"#hero"`)
- Default: `undefined`

If set, waits for an element matching this selector to be visible before taking the screenshot.

### **delay**

- Type: `number` (milliseconds)
- Default: `0`

Extra time to wait before taking the screenshot, eg. for fonts or animations to settle.

### **timeout**

- Type: `number` (milliseconds)
- Default: `30000`

Maximum time to wait for navigation and `waitForSelector`. `0` disables the timeout.

### **concurrency**

- Type: `number`
- Default: `4`

Maximum number of pages captured at the same time.
