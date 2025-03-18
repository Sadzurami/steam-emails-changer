# Steam Emails Changer

**Archived: Kopeechka.store is shut down.**

Simple app to change emails on Steam accounts

## Features

- Integrated with [kopeechka.store](https://kopeechka.store) email service
- Utilizes [steam sessions](https://github.com/Sadzurami/steam-sessions-creator)
- Supports proxies
- Exports results to file
- Fast and easy to use

## How to start

- Download the latest [release](https://github.com/Sadzurami/steam-emails-changer/releases#latest)
- Place your steam sessions in directory `sessions`
- Place your proxies in `proxies.txt` (optional)
- Start the app, config file will be created
- Close the app, edit the `config.json` file
- Start the app again

## Config

```json
{
  "KopeechkaApiKey": "...",
  "KopeechkaDomains": ["..."],
  "WaitMessageSeconds": 100
}
```

- `KopeechkaApiKey` - your kopeechka.store api key
- `KopeechkaDomains` - list of domains to use for emails
- `WaitMessageSeconds` - seconds to wait for email message

## Usage

```txt
$ steam-emails-changer --help

  Usage: Steam-Emails-Changer [options]

  Simple app to change emails on Steam accounts

  Options:
    -V, --version           output the version number
    -c, --config <path>     path to config file (default: "./config.json")
    -p, --proxies <path>    path to proxies file (default: "./proxies.txt")
    -r, --results <path>    path to results file (default: "./results.txt")
    -s, --sessions <path>   path to sessions directory (default: "./sessions")
    --silent-exit           exit process automatically on finish
    --concurrency <number>  concurrency limit for global operations
    -h, --help              display help for command
```

## Supported data formats

### Sessions

- `steamsession`

### Proxies

- `http://host:port`
- `http://username:password@host:port`

## FAQ

### How to get Steam sessions

Create them with [steam-sessions-creator](https://github.com/Sadzurami/steam-sessions-creator).

### How to set up proxies

Place your proxies in `proxies.txt` file in [supported formats](#supported-data-formats).

You can also set them in session files for account-specific proxies.

### Where results are saved

Results are saved to `results.txt` file.

### How to speed up the process

Add more proxies.

### Why do I see fewer sessions than I have

Some sessions may be invalid or expired.

## Related

- [steam-sessions-creator](https://github.com/Sadzurami/steam-sessions-creator) - App for creating and updating Steam sessions
- [node-kopeechka-store](https://github.com/Sadzurami/node-kopeechka-store) - Node.js wrapper for kopeechka.store api
- [kopeechka-s](https://github.com/Sadzurami/kopeechka-s) - Browser Automation Studio wrapper for kopeechka.store api
