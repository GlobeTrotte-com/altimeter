# Changelog

## [0.1.0](https://github.com/GlobeTrotte-com/altimeter/compare/v0.0.5...v0.1.0) (2026-11-15)


### ⚠ BREAKING CHANGES

* default image size is now 1200x630 and `dir` is resolved relative to the config file ([#29](https://github.com/GlobeTrotte-com/altimeter/issues/29))
* add an `exports` map, so deep imports such as `@globetrotte/altimeter/dist/...` no longer work ([#29](https://github.com/GlobeTrotte-com/altimeter/issues/29))

### Features

* add `format`, `quality`, `deviceScaleFactor`, `colorScheme`, `reducedMotion`, `hideSelectors`, `css`, `selector`, `headers`, `userAgent` and `httpCredentials` options ([#29](https://github.com/GlobeTrotte-com/altimeter/issues/29)) ([437ce28](https://github.com/GlobeTrotte-com/altimeter/commit/437ce28e29e9dfe8277a46467190115b55053f59))
* add `waitUntil`, `waitForSelector`, `delay`, `timeout` and `concurrency`; a failing page no longer aborts the run and the CLI exits non-zero when any page fails ([#27](https://github.com/GlobeTrotte-com/altimeter/issues/27)) ([437ce28](https://github.com/GlobeTrotte-com/altimeter/commit/437ce28e29e9dfe8277a46467190115b55053f59))
* add an `exports` map, so deep imports such as `@globetrotte/altimeter/dist/...` no longer work ([#29](https://github.com/GlobeTrotte-com/altimeter/issues/29)) ([437ce28](https://github.com/GlobeTrotte-com/altimeter/commit/437ce28e29e9dfe8277a46467190115b55053f59))
* default image size is now 1200x630 and `dir` is resolved relative to the config file ([#29](https://github.com/GlobeTrotte-com/altimeter/issues/29)) ([437ce28](https://github.com/GlobeTrotte-com/altimeter/commit/437ce28e29e9dfe8277a46467190115b55053f59))
* install the browser on first run instead of at npm install, and add `channel` and `executablePath` to use an installed browser ([#27](https://github.com/GlobeTrotte-com/altimeter/issues/27)) ([437ce28](https://github.com/GlobeTrotte-com/altimeter/commit/437ce28e29e9dfe8277a46467190115b55053f59))
* the CLI takes a URL, finds altimeter.config.json on its own and accepts flags that override the config ([#29](https://github.com/GlobeTrotte-com/altimeter/issues/29)) ([437ce28](https://github.com/GlobeTrotte-com/altimeter/commit/437ce28e29e9dfe8277a46467190115b55053f59))
* validate the config before launching a browser and warn about unknown keys ([#27](https://github.com/GlobeTrotte-com/altimeter/issues/27)) ([437ce28](https://github.com/GlobeTrotte-com/altimeter/commit/437ce28e29e9dfe8277a46467190115b55053f59))


### Bug Fixes

* **deps:** bump playwright-core, eslint and typescript-eslint; clear minimatch advisory ([#40](https://github.com/GlobeTrotte-com/altimeter/issues/40)) ([1550b0c](https://github.com/GlobeTrotte-com/altimeter/commit/1550b0ca2882e549d3eac25ac067e277c73b297c))
