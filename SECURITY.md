# Security

This project is a read-only bridge inside a private Tailscale network. It does not provide a public gateway.

- Keep `.local/`, tokens, device addresses, Magpie account files and real usage out of Git.
- The bridge calls only a loopback Magpie endpoint and projects allowlisted aggregate fields.
- The bridge token does not grant model inference, account management or configuration access.
- Scriptable stores connection settings in Keychain. The dashboard receives its token through a fragment, removes it from the address bar immediately, and keeps it in sessionStorage for that tab.
- Browser content uses a restrictive Content Security Policy, no third-party assets, no analytics, and no API CORS.
- HTTP is intended only inside the encrypted Tailnet. Do not expose this service with Funnel or a public port mapping.
- Raw Magpie requests, OAuth sign-ins, provider keys, account email addresses and session content are not persisted by this project.
- Screenshots in this repository use fictional fixtures only.

For a suspected vulnerability, contact the repository owner through GitHub's private security advisory mechanism where available. Do not attach private configuration or account data to public issues.
