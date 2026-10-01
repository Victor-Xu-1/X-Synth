# ASKCOS Runtime Control Layer

This directory is the source of truth for the local ASKCOSv2 runtime control layer.
It centralizes service profiles, workspace layout, and operational entrypoints while
leaving ASKCOS model source trees in their upstream locations.

## Layout

| Path | Purpose |
| --- | --- |
| `runtime/manifests/services.yaml` | Service, profile, port, and model capability registry. |
| `runtime/manifests/workspace.yaml` | Workspace map for core, UI, model roots, wrappers, and generated artifacts. |
| `runtime/scripts/askcosctl.py` | Primary CLI for profile start/stop/status/workspace/doctor/repo-status/cleanup planning. |
| `runtime/scripts/askcosctl.ps1` | Windows wrapper when running from `askcos2_core`. |
| `../askcosctl.cmd` | Top-level Windows entrypoint from `ASKCOSv2`. |
| `../askcosctl.ps1` | Top-level PowerShell entrypoint when script execution is allowed. |
| `../askcosctl.sh` | Top-level WSL/Linux entrypoint from `ASKCOSv2`. |

## Common Commands

| Command | Use |
| --- | --- |
| `../askcosctl.sh workspace --json` | Show the workspace map and generated artifact boundaries. |
| `../askcosctl.sh doctor --json` | Check control files, source roots, wrappers, and cleanup candidates. |
| `../askcosctl.sh repo-status --json` | Summarize managed Git roots and dirty working trees. |
| `../askcosctl.sh status --json` | Show current Docker Compose runtime state. |
| `../askcosctl.sh health --json` | Check whether all 23 full-stack services are running and ready. |
| `../askcosctl.sh health --probe-endpoints --json` | Also probe manifest HTTP health endpoints. |
| `../askcosctl.sh plan clean --json` | Show generated artifacts that would be removed by a future cleanup step. |
| `../askcosctl.sh plan start --json` | Show the locked full-stack start plan. |
| `../askcosctl.sh start` | Start the locked full ASKCOS backend stack and wait until it is ready. |
| `../askcosctl.sh start all` | Alias for the locked full ASKCOS backend stack. |
| `../askcosctl.sh start --no-wait` | Start the full stack without waiting for readiness. |
| `../askcosctl.sh stop` | Stop ASKCOS Compose services. |

Windows wrappers derive the WSL distribution and Linux project path from the
`\\wsl.localhost\<distro>\...` script location. Set
`ASKCOSCTL_WSL_TIMEOUT_SECONDS` to bound a stuck `wsl.exe` call; timed-out
wrapper calls exit with code `124`.

## Boundary

The control layer does not merge all model services into one process. ASKCOSv2 is
a multi-service system, and model dependencies remain isolated by service.

For local production-style operation, the runtime is locked to the full backend
stack: `start`, `start full`, and `start all` all start every manifest service,
and `stop` stops the full Compose project. Individual profile names remain in
the service manifest as documentation and diagnostics only; they are not exposed
as partial start targets through `askcosctl`.

`start` waits for Compose readiness by default. A successful start means every
manifest service is running and has an explicit Docker health check reporting
`healthy`. Services without a Docker health status are not treated as ready
unless `health --probe-endpoints` is explicitly used and their declared
`health_endpoint` responds.
