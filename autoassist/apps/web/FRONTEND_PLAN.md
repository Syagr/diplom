# AutoAssist Frontend — screen-by-screen plan (final)

This document outlines the final frontend scope strictly aligned with the current backend and diploma logic. Use it as the implementation checklist.

## Roles and navigation
- Guest
  - Login: Email/password (opt.) or Web3 (MetaMask: nonce/signature or SIWE)
  - Onboarding: short client form (name/phone/email), optional car binding
- Customer
  - Dashboard: my orders, unread counter, quick actions
  - Create order (wizard): data, photos, geo, confirmation
  - Quote/Payment: view estimate, choose method, Web3 payment, status, receipt link
  - Order details: status timeline, attachments, service center, actions (cancel/pay)
  - Proof-of-completion viewer: proofHash + evidence (own orders)
  - Notifications: inbox, pagination, mark-as-read, preferences
  - Profile/Settings: wallet, contacts, notifications
  - Receipts: list and download PDF
- Staff/Admin
  - Orders board/table: filters, search, live updates
  - Order details (staff): status changes, tow assignment, appointment
  - Calc profiles: CRUD
  - Service centers: CRUD with map
  - Broadcast notifications: send by role
  - Metrics/health (optional): health, metrics

## API and events (bindings)
- Auth (Web3)
  - POST /api/auth/wallet/nonce → {address} → {nonce,message}
  - POST /api/auth/wallet/verify → {address+signature(+chainId)} or {siweMessage,signature}
- Orders
  - POST /api/orders → create + locations(pickup)
  - GET /api/orders → list (filters: status, category, pagination)
  - GET /api/orders/:id → details (RBAC: owner/staff)
  - PUT /api/orders/:id/status → change status (client limits)
  - POST /api/orders/:id/complete → complete + proofHash
  - GET /api/orders/:id/proof → read proof (owner/staff)
- Payments
  - Web3 verify endpoint: after MetaMask → send txHash → server verifies with confirmations and timeout
  - Receipt generation (receiptUrl → /api/attachments/:id/url)
- Notifications
  - GET /api/notifications (+pagination, unreadOnly, type)
  - PUT /api/notifications/:id/read
  - GET/PUT /api/notifications/preferences
  - GET /api/notifications/unread-count
  - WS: realtime events (toast + list updates)
- Service centers
  - GET/CRUD /api/service-centers (admin), GET list (customer read-only)
- Calc profiles
  - CRUD /api/calc-profiles (admin)
- Sockets (io)
  - Per-order channel: room order:{id}
  - Role/dashboard channels (dashboard), notifications user:{id}

## Screens (details)
- Login/Registration
  - Web3: “Connect MetaMask”, enforce chainId (80002 Amoy); if mismatch → prompt to switch
  - Nonce/Message → sign → verify → receive tokens (HttpOnly already set by API; optional in-memory duplication)
  - SIWE (optional)
  - Email/password (optional)
  - Errors: WRONG_CHAIN, INVALID_SIGNATURE, NONCE_EXPIRED
- Customer Dashboard
  - Order cards with status/priority, “Pay/Details” CTA
  - Unread counter, last notifications (3–5)
  - Quick action “New order”
- New Order Wizard
  - Steps: client data (if missing), car (plate/make/model/year), problem (category + description), photos (<=10, previews, progress, delete), geo (react-leaflet), resume → POST /api/orders
  - Validations: required fields, photo size/count, coordinates
- Orders List
  - Table/cards with filters by status/category, pagination
  - Status color, priority badge
  - React to socket “order:created/updated”
- Order Details (customer)
  - Timeline from /orderTimeline
  - Attachments preview
  - Assigned service center with map
  - Actions: Pay (if estimate exists and unpaid), Cancel (if allowed), Open receipt (if receiptUrl), View proof (when completed)
  - Web3 indicator for confirmation/verification pending
- Quote/Payment
  - Show estimate (items, labor, total)
  - Estimate status: LOCKED/APPROVED
  - Payment methods: Classic (mock) or Web3 MATIC/USDC
  - After tx: txHash input (if not intercepted) → verify → status/error
  - On success: show receipt link, toast + notification
- Notifications (Inbox)
  - List: type, title, text, date, “read” flag
  - Pagination, type filter, mark-as-read
  - Preferences: channels (IN_APP/EMAIL), types
  - Toast center: realtime via socket; priority mapping LOW→info, MEDIUM→success, HIGH→warn, URGENT→error
- Proof Viewer
  - GET /orders/:id/proof → display proofHash and evidence (photos/coords/time)
  - “Copy hash”, show on order details
- Receipts
  - List by payments → open/download PDF (presigned URL)
  - QR links to Polygonscan in PDF
- Admin: Orders Board
  - Table/kanban, filters by status/center/priority, search
  - Live updates from sockets
  - Batch actions (optional later; start with single actions)
- Admin: Order Details
  - Full timeline, status change buttons
  - Tow assignment (if enabled), appointment
  - Trigger notification to client (ORDER_UPDATED, TOW_ASSIGNED)
- Admin: Calc Profiles
  - CRUD (coeffs/active), validation
  - Preview cost impact (quick calc for a sample order)
- Admin: Service Centers
  - List, CRUD, map coordinate picker
  - Fields: name/phone/email/city/address, schedule/amenities JSON
- Admin: Broadcast
  - Form: title, message, priority, targetRole, channels → POST /api/notifications/broadcast
  - Result: delivered count
- Map/Geo
  - Nearby centers search — radius and list
  - Pull from /api/service-centers, filter by Haversine on FE or server

## Frontend tech
- React + Vite + TypeScript
- Router: React Router 6
- State: TanStack Query for server cache; lightweight Zustand/Context for auth/ui if needed
- Forms: react-hook-form + zod (optional)
- UI: current app uses Tailwind/Headless UI; keep this stack
- Socket: socket.io-client (user:{id}, order:{id}, dashboard)
- Web3: ethers.js (+ MetaMask provider), SIWE/signature (optional)
- Map: react-leaflet + leaflet
- Utilities: date-fns, axios

## Contracts and states
- Auth
  - Inputs: address/signature/(siweMessage)
  - Outputs: access/refresh cookies or tokens
  - Errors: WRONG_CHAIN, INVALID_SIGNATURE, NONCE_EXPIRED
- Payments Web3
  - Inputs: txHash (if not intercepted)
  - Outputs: COMPLETED/FAILED and receiptUrl
  - Errors: CHAIN_MISMATCH, RPC_UNAVAILABLE, TX_TIMEOUT, TX_FAILED, AMOUNT/DEST_MISMATCH
- Notifications
  - Realtime priority mapping: LOW→info, MEDIUM→success, HIGH→warn, URGENT→error
  - Inbox: mark-as-read, prefs persist
- Orders FSM
  - Client: NEW→CANCELLED, QUOTE→APPROVED/CANCELLED, READY→DELIVERED
  - Staff: service transitions allowed

## UX and edge cases
- Poor internet: optimistic UI only for safe actions; disable repeat-clicks
- MetaMask not installed: guide + link
- Wrong chain: Banner “Switch to Polygon Amoy”
- Web3 RPC down/slow: retry + hint to try again
- No email: worker logs to console; hide pure “send email” buttons on FE

## Iterations (implementation order)
1) App skeleton is ready. Ensure AuthContext/axios token interceptor/socket connection (already wired).
2) Customer MVP: Dashboard (list snippet), Orders list, Details, New wizard.
3) Notifications: toasts + inbox with unread counter.
4) Payments: Quote/Payment screen, Web3 flow + verify, show receipt.
5) Proof/Receipts: proof viewer, receipts list + download.
6) Admin: Board/Table, Details (statuses), Broadcast, CalcProfiles, ServiceCenters.
7) Geo map: nearest centers search + pickup selection.
8) Polish/Docs/Tests: smoke E2E (login → create order → pay mock/web3 → notification → proof view), README steps.

---

Single source of truth for FE scope. Keep this synced with backend updates.# Frontend Refactor Plan (by screens)

This plan aligns the SPA with the current backend and the thesis business logic. It defines navigation by roles, screen contracts, API bindings, socket channels, and iteration order. Implementation follows a feature‑first folder structure without introducing heavy new deps, using existing React + Router + axios + socket.io‑client + Tailwind.

## Roles and navigation

- Guest
  - Login/Register: Email/password (optional) or Web3 (MetaMask: nonce/signature or SIWE)
  - Onboarding (short client form: name/phone/email, optional vehicle link)
- Customer (role: `customer`)
  - Dashboard: my orders, unread count, quick actions
  - New Order wizard: data, photos, geo, confirmation
  - Estimate/Payment: view estimate, choose method, Web3 payment, status, receipt link
  - Order details: status timeline, attachments, service center, actions
  - Proof viewer: proofHash + evidence for owned orders
  - Notifications: inbox, pagination, mark-as-read, preferences
  - Profile/Settings: wallet, contacts, notifications
  - Receipts: list and download PDF
- Staff/Admin (roles: `service_manager`, `admin`)
  - Orders board/table: filters, search, live updates
  - Order details (staff): status change, tow assignment, appointment
  - Calc profiles: CRUD
  - Service centers: CRUD + map
  - Broadcast notifications by role
  - Metrics/Health (optional)

## API bindings (current backend)

- Auth (Web3)
  - POST `/api/auth/wallet/nonce` → { address } → { nonce, message? }
  - POST `/api/auth/wallet/verify` → { address, signature, chainId? } or { siweMessage, signature }
- Orders
  - POST `/api/orders` (locations.pickup)
  - GET `/api/orders` (filters: status, category, pagination)
  - GET `/api/orders/:id`
  - PUT `/api/orders/:id/status`
  - POST `/api/orders/:id/complete` (proofHash)
  - GET `/api/orders/:id/proof`
- Payments
  - Web3 verify: send `txHash` → server validates (chain ID, confirmations, timeout) and sets `receiptUrl` (Attachment presigned)
- Notifications
  - GET `/api/notifications` (pagination, `unreadOnly`, `type`)
  - PUT `/api/notifications/:id/read`
  - GET/PUT `/api/notifications/preferences`
  - GET `/api/notifications/unread-count`
  - WS: real‑time events toasts + inbox updates
- Service centers
  - GET/CRUD `/api/service-centers` (admin), read-only list for customer; nearby: `/api/service-centers/nearby`
- Calc profiles
  - CRUD `/api/calc-profiles` (admin)
- Sockets (io)
  - Rooms per order: `order:{id}`
  - Dashboards by role: `dashboard`
  - Notifications by user: `user:{id}` or `notification` event

## Screens and requirements

- Auth/Register
  - Web3 connect MetaMask, enforce chainId 80002 (Polygon Amoy)
  - Nonce→sign→verify → tokens; SIWE optional
  - Errors: WRONG_CHAIN, INVALID_SIGNATURE, NONCE_EXPIRED
- Customer Dashboard
  - Cards of orders, unread counter, latest notifications (3-5), “New order” CTA
- New Order Wizard
  - Steps: client/vehicle, problem (category/description), photos (up to 10), geo (map; pick `pickup`), summary→POST
  - Validations: required fields, photo size/qty, coords
- Orders List
  - Filters by status/category, pagination; status badge and priority
  - Socket reactions: `order:created`, `order:updated`
- Order Details (customer)
  - Timeline, attachments preview, service center map
  - Actions: pay, cancel (if allowed), open receipt, open proof viewer
  - Web3 indicator for pending verification
- Estimate/Payment
  - Show estimate (items, labor, total), status LOCKED/APPROVED
  - Payment method: classic test or Web3 (MATIC/USDC)
  - After submit tx: send `txHash` to verify; on success show `receiptUrl`
- Notifications Inbox
  - List: type, title, message, date, read toggle; filters + pagination
  - Prefs: channels/types; realtime toast mapping by priority (LOW→info, MEDIUM→success, HIGH→warn, URGENT→error)
- Proof Viewer
  - GET `/orders/:id/proof` → proofHash + evidence; copy hash UI
- Receipts
  - List receipts by payments; open/download PDF (via presigned URL)
- Admin Board
  - Orders table/kanban; filters (status/center/priority), search; live updates
- Admin Order Details
  - Full timeline, status transitions, tow/appointment, manual notify
- Admin Calc Profiles
  - CRUD; validation; preview effect on sample order
- Admin Service Centers
  - CRUD + map; fields: name/phone/email/city/address; schedule/amenities JSON
- Admin Broadcast
  - Form: title, message, priority, targetRole, channels → POST `/api/notifications/broadcast`

## Project structure (proposed)

```
src/
  app/              # router, layouts, providers
  features/
    auth/           # wallet login, guards (uses existing utils/auth)
    orders/         # list, detail, wizard
    payments/       # estimate, pay flow, web3 verify
    notifications/  # inbox, prefs, toasts
    service-centers/# list, map
    admin/          # board, order-detail, calc-profiles, service-centers, broadcast
    receipts/       # list, download
    profile/        # settings
  shared/
    api/            # axios instance, endpoint fns
    hooks/          # useSocket, useAuth
    components/     # Button, Modal, Form, Table, Map, etc.
    utils/          # format, guards
```

## Iteration order

1) App skeleton: Router, Auth guard, Socket hookup, axios client.  
2) Customer MVP: Dashboard, Orders list, Order details, New order wizard.  
3) Notifications: toasts + inbox + unread counter.  
4) Payments: Estimate/Pay + Web3 verify + receipt.  
5) Proof/Receipts: Proof viewer + receipts list/download.  
6) Admin: Board + details + broadcast + calc‑profiles + service‑centers.  
7) Geo map: nearby centers (customer) + CRUD map (admin).  
8) Polish/Docs/Tests: happy-path E2E smoke.

## Edge cases

- Bad network: disable double clicks; optimistic only for safe UI.  
- MetaMask absent: guide + link to install.  
- Wrong chain: banner “Switch to Polygon Amoy”.  
- RPC slow/down: retry with backoff; show retry CTA.  
- No email: hide explicit “Send email” CTA; rely on in‑app notifications.

---

This document is the implementation contract. The following folders and screen stubs are created to accelerate execution. Fill the stubs with real UI progressively while wiring endpoints and sockets.
