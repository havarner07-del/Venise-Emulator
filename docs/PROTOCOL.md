# Venise Net Protocol, version 1

This is how Venise games talk to each other. Each player's Venise is a **client**. One person runs the **server** (`server/venise-server.js`), and every client connects to it. The server groups clients into **rooms**. It relays messages between players in a room and keeps a small shared **state** for each room.

```
 Venise (client) ─┐
 Venise (client) ─┼──  WebSocket  ──  venise-server.js  (rooms, relay, shared state)
 Venise (client) ─┘
```

Games never open sockets themselves. They use the `net` table in Lua (see [Lua API](#lua-api)), and Venise speaks this protocol for them.

## Transport

- A [WebSocket](https://datatracker.ietf.org/doc/html/rfc6455) connection, `ws://host:port/`. The default port is **7777**.
- Every message is one WebSocket **text** frame holding one JSON object. Binary frames close the connection.
- Every message has a string field `t`, its type. Unknown fields are ignored, so later versions can add fields.
- A plain HTTP `GET` to the same address returns a JSON summary of the server's rooms and players. It's useful for checking that the server is up.

## Connection lifecycle

1. The client opens the WebSocket and sends `hello` as its first message.
2. The server answers with `welcome`, or with `error` and closes the connection.
3. Both sides exchange messages until one of them closes.
4. When a client leaves, for any reason, everyone else in its room receives `leave`.

A client that doesn't send `hello` within 10 seconds is disconnected. The server sends a WebSocket ping every 15 seconds and drops clients it hasn't heard from in 45 seconds. Browsers answer WebSocket pings on their own.

When the last player leaves a room, the room and its state are deleted.

## Client → server

### `hello`

Joins a room. It must be the first message and can only be sent once.

```json
{ "t": "hello", "v": 1, "name": "alice", "room": "coinrun" }
```

| Field | Type | Notes |
|---|---|---|
| `v` | number | Protocol version. Must be `1`, or the server replies with the error `version` |
| `name` | string | Display name, up to 24 characters. Default `"player"`. If someone in the room already uses it (ignoring case), the server adds `-2`, `-3` and so on |
| `room` | string | Room to join, up to 32 characters. Default `"lobby"`. Created if it doesn't exist |

### `msg`

Sends data to the other players in the room.

```json
{ "t": "msg", "ch": "pos", "data": { "x": 60, "y": 104 } }
{ "t": "msg", "ch": "chat", "data": "hi bob", "to": 2 }
```

| Field | Type | Notes |
|---|---|---|
| `ch` | string | Channel name, up to 32 characters. The game decides what channels mean |
| `data` | any JSON | The payload. Optional, defaults to `null` |
| `to` | number | Optional. Sends only to the player with this id. Without it, everyone in the room except the sender gets the message |

### `set`

Changes the room's shared state. The server applies sets one at a time and sends each one to **everyone in the room, including the sender**, so all players see the same changes in the same order.

```json
{ "t": "set", "key": "best", "value": 42 }
{ "t": "set", "key": "best", "value": null }
```

| Field | Type | Notes |
|---|---|---|
| `key` | string | Up to 64 characters |
| `value` | any JSON | `null` deletes the key. A room holds at most 256 keys |

### `ping`

Measures the round trip. The server replies with `pong` and the same `n`.

```json
{ "t": "ping", "n": 1234.5 }
```

## Server → client

### `welcome`

Sent once, in reply to `hello`.

```json
{ "t": "welcome", "v": 1, "id": 3, "name": "alice", "room": "coinrun",
  "peers": [ { "id": 1, "name": "bob" } ],
  "state": { "best": 42 } }
```

`id` is this client's player id. It is unique on the server for as long as the server runs. `name` is the final name, which may have a suffix added. `peers` lists everyone else already in the room. `state` is the room's shared state right now.

### `join` / `leave`

Another player joined or left the room.

```json
{ "t": "join", "id": 4, "name": "carol" }
{ "t": "leave", "id": 4, "name": "carol", "reason": "connection lost" }
```

### `msg`

Data from another player. `private` is `true` when the sender addressed it to you with `to`.

```json
{ "t": "msg", "from": 1, "ch": "pos", "data": { "x": 60, "y": 104 } }
{ "t": "msg", "from": 1, "ch": "chat", "data": "hi alice", "private": true }
```

### `set`

A change to the room's shared state. `from` is the id of the player who made it.

```json
{ "t": "set", "from": 1, "key": "best", "value": 42 }
```

### `pong`

```json
{ "t": "pong", "n": 1234.5 }
```

### `error`

Something the client sent was rejected.

```json
{ "t": "error", "code": "no_peer", "text": "no player #9 in this room" }
```

| Code | Meaning | Closes the connection? |
|---|---|---|
| `bad_hello` | A message came before `hello`, `hello` was sent twice, or `hello` never came | Yes, except for a second `hello` |
| `version` | The `hello` asked for a protocol version the server doesn't speak | Yes |
| `room_full` | The room already has 16 players | Yes |
| `bad_json` | The message wasn't a JSON object with a string `t` | No |
| `unknown_type` | `t` isn't a known message type | No |
| `bad_field` | A required field is missing or has the wrong type | No |
| `no_peer` | `msg` named a `to` player who isn't in the room | No |
| `state_full` | `set` would add a 257th key | No |
| `rate_limit` | More than 60 messages a second (bursts of up to 120 are allowed). The message was dropped | No |

The server closes the connection with WebSocket code `1009` for a message larger than 16 KiB, `4000` after a fatal `error`, and `4001` when the client times out.

## Limits

| Limit | Value |
|---|---|
| Message size | 16 KiB |
| Player name | 24 characters |
| Room name | 32 characters |
| Channel name | 32 characters |
| State key | 64 characters |
| Players per room | 16 |
| State keys per room | 256 |
| Message rate | 60 a second, bursts of 120 |

These are set in `LIMITS` at the top of `server/venise-server.js`.

## Lua API

Venise gives games a `net` table. All of its functions return immediately. What happens on the network reaches the game through callbacks, which Venise calls at the start of each frame, before `_update()`.

| Function | What it does |
|---|---|
| `net.connect(address, name, room)` | Connects and joins `room` as `name`. `address` can be `"localhost"`, `"192.168.1.5"`, `"192.168.1.5:9000"` or a full `ws://` / `wss://` URL. Port 7777 is used when none is given. `name` defaults to `"player"`, `room` to `"lobby"`. Connecting again first drops the old connection |
| `net.disconnect()` | Leaves the server |
| `net.send(channel, data, to)` | Sends `data` on `channel` to everyone else in the room, or only to player `to`. Returns `false` if not connected |
| `net.set(key, value)` | Changes the room's shared state. `nil` deletes the key. The change takes effect when the server echoes it back, so `net.get` still returns the old value until the next frame |
| `net.get(key)` | Reads the shared state |
| `net.state()` | The whole shared state as a table |
| `net.peers()` | The other players: a list of `{ id = ..., name = ... }` |
| `net.id()` | Your player id, or `nil` if not connected |
| `net.status()` | A table with `status` (`"closed"`, `"connecting"` or `"open"`), `id`, `name`, `room`, `url`, `ping` in milliseconds, and `players` (everyone in the room, including you) |

| Callback | Called when |
|---|---|
| `_connected(id, name, room)` | The server accepted you |
| `_joined(id, name)` | Another player joined |
| `_left(id, name, reason)` | Another player left |
| `_message(from, channel, data, private)` | A `msg` arrived |
| `_state(key, value, from)` | The shared state changed, including your own changes |
| `_disconnected(reason)` | The connection closed or couldn't be opened |
| `_neterror(code, text)` | The server sent an `error`. Without this callback the error is shown in the Output panel |

Detaching, injecting again, or a game crash all close the connection.

### Lua values on the wire

Data is sent as JSON, so it goes through a conversion:

- `nil` becomes `null`. Booleans, numbers and strings stay as they are. `inf` and `nan` can't be sent.
- A table whose keys are exactly `1..n` becomes a JSON array and comes back as a list.
- Any other table becomes a JSON object. Number keys turn into strings, so `{ [5] = "x" }` arrives as `{ ["5"] = "x" }`.
- An empty table is sent as `{}`.
- Functions, coroutines and userdata can't be sent. Neither can tables nested more than 16 levels deep, which includes tables that contain themselves.

## Example

The **Multiplayer.lua** example adds multiplayer to the built-in Coin Run game. Each player sends its position on the `pos` channel every other tick, and the room's high score is kept in shared state under `best`.

```lua
net.connect("localhost", "alice", "coinrun")

others = {}
function _joined(id, name) others[id] = { name = name, x = 60, y = 104 } end
function _left(id) others[id] = nil end
function _message(from, channel, data)
  if channel == "pos" and others[from] then others[from].x = data.x end
end
```

A session on the wire looks like this:

```
alice → server   {"t":"hello","v":1,"name":"alice","room":"coinrun"}
server → alice   {"t":"welcome","v":1,"id":1,"name":"alice","room":"coinrun","peers":[],"state":{}}
bob   → server   {"t":"hello","v":1,"name":"bob","room":"coinrun"}
server → bob     {"t":"welcome","v":1,"id":2,"name":"bob","room":"coinrun","peers":[{"id":1,"name":"alice"}],"state":{}}
server → alice   {"t":"join","id":2,"name":"bob"}
alice → server   {"t":"msg","ch":"pos","data":{"x":61.5,"y":104}}
server → bob     {"t":"msg","from":1,"ch":"pos","data":{"x":61.5,"y":104}}
bob   → server   {"t":"set","key":"best","value":3}
server → alice   {"t":"set","from":2,"key":"best","value":3}
server → bob     {"t":"set","from":2,"key":"best","value":3}
```

## Security

The server has no accounts or passwords, and messages aren't encrypted over `ws://`. Anyone who can reach the port can join any room and send anything. Run it on your own computer or local network, and don't open the port to the internet unless you put it behind something that adds TLS (`wss://`) and access control. Games should treat everything they receive as untrusted input.
