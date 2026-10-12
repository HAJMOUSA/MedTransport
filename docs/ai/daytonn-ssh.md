# Daytonn SSH Context

Use this reference when connecting to or administering the Daytonn Ubuntu home server for the MidTransport project.

## Connection

Primary SSH alias:

```powershell
ssh daytonn-home-vpn
```

Fallback LAN alias, only when on the same local network:

```powershell
ssh daytonn-home-lan
```

Known server details:

- Hostname: `daytonn`
- SSH user: `hajmousa`
- Tailscale hostname: `daytonn-home-vpn`
- Tailscale IP: `100.115.167.17`
- LAN IP: `192.168.0.33`
- Local identity file: `~/.ssh/daytonn_home_vpn_ed25519`

Do not store or request long-lived passwords unless key login fails and the user explicitly provides a temporary password.

## Common Checks

Verify login:

```powershell
ssh -o BatchMode=yes daytonn-home-vpn "hostname && whoami"
```

Check Tailscale status:

```powershell
ssh daytonn-home-vpn "tailscale status && tailscale ip -4"
```

Check exit-node forwarding:

```powershell
ssh daytonn-home-vpn "sysctl net.ipv4.ip_forward net.ipv6.conf.all.forwarding"
```

Expected forwarding values:

```text
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
```

## Admin Workflow

Run privileged commands with `sudo` only when needed. Prefer inspecting state before changing it, and keep commands non-destructive unless the user explicitly asks otherwise.

For future VPN work, use `daytonn-home-vpn` over Tailscale first. Use `daytonn-home-lan` only for local-network recovery or if Tailscale is unavailable.
