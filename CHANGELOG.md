# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [6.0.0-beta.4] - 2020-08-25

### Added

- We now support `Date` values as `Literal`s. This means you can escape and interpolate dates.

## [6.0.0-beta.3] - 2020-08-25

### Changed

- The `SimplePostgres` functions `escape` and `escapeLiteral` now clearly indicate that they always return a `string`.

## [6.0.0-beta.2] - 2020-08-23

### Changed

- Correctly bump version number this time.

## [6.0.0-beta.1] - 2020-08-23

### Changed

- Upgrade to TypeScript 4.

## [6.0.0-alpha.5] - 2020-08-20

### Fixed

- Export `SimplePostgres` type.

## [6.0.0-alpha.4] - 2020-08-20

### Changed

- Release this internal fork publicly, so we can use it as a dependency of other public packages. We'd still be interested in merging upstream later.

## [6.0.0-alpha.3] - 2020-08-20

### Added

- `SimplePostgres.end` will shut down the associated connection pool and clear any internal timers. This should help tests exit cleanly.

## [6.0.0-alpha.2] - 2020-08-19

### Fixed

- Fix broken package.

## [6.0.0-alpha.1] - 2020-08-19

### Added

- Full native TypeScript support.
- Nested "transactions" using `SAVEPOINT`.
- Native ECMAScript module support, including non-`default` exports for escaping and templating functions.
- A number of new APIs, including one for parsing a URL into configuration options, which can then be further customized.

### Changed

- Some configuration options may be slightly different if you use manual configuration.
- We now lint with `eslint`.
- We now format code with `prettier`'s default options.
- Much of the code has been heavily overhauled.
- Test coverage has been updated to 100% line coverage using `c8`.
- Escaping functions now always return `string` and never `number`.

### Fixed

- A few weird corner-cases should be better-defined, thanks to TypeScript.

### Removed

- Unfortunately, `cancel` support has been removed, because I couldn't find any documented way to support it. (And because Faraday no longer uses it anywhere.)
