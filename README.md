# Sliver C2 MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for interacting with the [Sliver C2](https://github.com/BishopFox/sliver) adversary emulation framework.

This server enables AI assistants to manage Sliver C2 infrastructure, including sessions, beacons, listeners, and implant interactions for authorized red team operations.

## Features

- **Server Management** - Version info, operator listing
- **Session Control** - List, interact with, and terminate real-time implant connections
- **Beacon Management** - Monitor asynchronous callback implants
- **Listener Operations** - Start/stop mTLS, HTTPS, HTTP, DNS, and WireGuard listeners
- **Implant Management** - View builds and generation profiles
- **File Operations** - Upload, download, list, navigate filesystem on targets
- **Command Execution** - Execute programs and shell commands on compromised hosts
- **System Enumeration** - Process listing, network interfaces, connections, screenshots
- **Pivoting** - TCP pivot listeners for lateral movement
- **Intelligence** - Harvested credentials and discovered hosts

## Prerequisites

1. **Sliver C2 Server** - Running and accessible instance
2. **Operator Configuration** - Generated via `new-operator` command in Sliver console
3. **Python 3.10+** with sliver-py:
   ```bash
   pip install sliver-py
   ```
4. **Node.js 20+**

## Installation

```bash
git clone https://github.com/schwarztim/sec-sliver-c2-mcp.git
cd sec-sliver-c2-mcp
npm install
npm run build
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SLIVER_OPERATOR_CONFIG` | Path to operator .cfg file | (required) |
| `PYTHON_PATH` | Python interpreter path | `python3` |
| `SLIVER_TIMEOUT` | Command timeout (ms) | `30000` |

### Command Line Arguments

```bash
node dist/index.js --operator-config /path/to/operator.cfg --python python3.11 --timeout 60000
```

## MCP Client Configuration

### Claude Desktop / Claude Code

Add to your MCP configuration (`~/.claude/user-mcps.json` or equivalent):

```json
{
  "mcpServers": {
    "sliver-c2": {
      "command": "node",
      "args": [
        "/path/to/sec-sliver-c2-mcp/dist/index.js",
        "--operator-config",
        "/path/to/your/operator.cfg"
      ]
    }
  }
}
```

## Available Tools

### Server Management
| Tool | Description |
|------|-------------|
| `sliver_version` | Get server version information |
| `sliver_operators` | List connected operators |

### Sessions (Real-time Implants)
| Tool | Description |
|------|-------------|
| `sliver_sessions` | List all active sessions |
| `sliver_kill_session` | Terminate a session |

### Beacons (Async Callback Implants)
| Tool | Description |
|------|-------------|
| `sliver_beacons` | List all beacons |

### Listeners
| Tool | Description |
|------|-------------|
| `sliver_listeners` | List active listeners |
| `sliver_start_mtls` | Start mTLS listener |
| `sliver_start_https` | Start HTTPS listener |
| `sliver_start_http` | Start HTTP listener |
| `sliver_start_dns` | Start DNS listener |
| `sliver_start_wg` | Start WireGuard listener |
| `sliver_kill_listener` | Stop a listener |

### Implant Management
| Tool | Description |
|------|-------------|
| `sliver_implant_builds` | List implant builds |
| `sliver_implant_profiles` | List generation profiles |

### File Operations (on target)
| Tool | Description |
|------|-------------|
| `sliver_ls` | List files |
| `sliver_pwd` | Get working directory |
| `sliver_cd` | Change directory |
| `sliver_mkdir` | Create directory |
| `sliver_rm` | Remove file/directory |
| `sliver_download` | Download file from target |
| `sliver_upload` | Upload file to target |

### Command Execution
| Tool | Description |
|------|-------------|
| `sliver_execute` | Execute program |
| `sliver_shell` | Execute shell command |

### System Enumeration
| Tool | Description |
|------|-------------|
| `sliver_ps` | List processes |
| `sliver_ifconfig` | Network interfaces |
| `sliver_netstat` | Network connections |
| `sliver_screenshot` | Capture screenshot |

### Pivoting
| Tool | Description |
|------|-------------|
| `sliver_pivot_listeners` | List pivot listeners |
| `sliver_pivot_start_tcp` | Start TCP pivot |

### Intelligence
| Tool | Description |
|------|-------------|
| `sliver_creds` | Harvested credentials |
| `sliver_hosts` | Discovered hosts |

## Generating Operator Configuration

On your Sliver C2 server console:

```
sliver > new-operator --name your-name --lhost your-server-ip
```

This generates a `.cfg` file containing mTLS certificates and server connection information.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   MCP Client    │────>│  sliver-c2-mcp   │────>│  Sliver Server  │
│ (Claude, etc.)  │<────│  (Node.js/TS)    │<────│    (gRPC)       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               v
                        ┌──────────────────┐
                        │   sliver-py      │
                        │   (Python)       │
                        └──────────────────┘
```

The MCP server acts as a bridge between MCP clients and Sliver C2, using the `sliver-py` Python library for reliable gRPC communication with the Sliver server.

## Security Considerations

**This tool is intended for authorized security testing only.**

- **Protect operator configs** - They provide full C2 infrastructure access
- **Authorization required** - Only use against systems you have explicit permission to test
- **Audit logging** - All operations are logged by the Sliver server
- **Network security** - Ensure secure transport between MCP client and this server

## Legal Disclaimer

This software is provided for authorized penetration testing and red team operations only. Users are responsible for ensuring they have proper authorization before using this tool against any systems. The authors assume no liability for misuse of this software.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev

# Run tests
npm test

# Lint
npm run lint
```

## License

MIT License - See [LICENSE](LICENSE) for details.

## Related Projects

- [Sliver C2](https://github.com/BishopFox/sliver) - Open source adversary emulation framework
- [sliver-py](https://github.com/moloch--/sliver-py) - Python client library for Sliver
- [Model Context Protocol](https://modelcontextprotocol.io/) - Open protocol for AI tool integration

## Contributing

Contributions are welcome. Please ensure all changes maintain compatibility with the Sliver C2 API and follow the existing code style.
