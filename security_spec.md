# Firestore Security Specification (Nuha AI Studio)

## 1. Data Invariants
1. A `UserProfile` document at `/users/{userId}` can only be read, created, or updated by the verified authenticated user whose `request.auth.uid == userId`. Listing `/users` is strictly denied to protect PII (`email`).
2. A `Conversation` document at `/users/{userId}/conversations/{conversationId}` must belong to `userId` (`data.userId == userId == request.auth.uid`) and use server timestamps (`request.time`) for `createdAt` and `updatedAt`.
3. A `Message` document at `/users/{userId}/conversations/{conversationId}/messages/{messageId}` cannot exist without a valid parent `Conversation` owned by `request.auth.uid` (enforced via Master Gate `get()`).
4. A `VectorDesign` document at `/users/{userId}/designs/{designId}` is strictly owned by `userId`, capped at 64KB SVG code, and immutable once created.
5. Every ID path variable (`userId`, `conversationId`, `messageId`, `designId`) must match `^[a-zA-Z0-9_\-]+$` and be at most 128 characters.

## 2. Adversarial "Dirty Dozen" Payloads
1. **Unauthenticated read/write**: `auth = null` reading `/users/u1/conversations/c1` -> `PERMISSION_DENIED`.
2. **Unverified email write**: `auth.token.email_verified = false` creating `/users/u1` -> `PERMISSION_DENIED`.
3. **Cross-user profile read (PII leak)**: `u2` reading `/users/u1` -> `PERMISSION_DENIED`.
4. **Blanket user directory list**: `u1` listing `/users` -> `PERMISSION_DENIED`.
5. **Shadow field injection on create**: Creating `/users/u1` with `{ ..., isAdmin: true }` -> `PERMISSION_DENIED`.
6. **Identity spoofing on conversation**: `u2` creating `/users/u1/conversations/c1` with `userId: "u2"` -> `PERMISSION_DENIED`.
7. **Orphan message write**: Creating `/users/u1/conversations/nonexistent/messages/m1` -> `PERMISSION_DENIED`.
8. **ID poisoning**: Creating `/users/u1/conversations/bad$id/..` or >128 char ID -> `PERMISSION_DENIED`.
9. **Client timestamp forgery**: Creating conversation with `createdAt: Timestamp.fromDate(new Date(0))` instead of `serverTimestamp()` -> `PERMISSION_DENIED`.
10. **Immutable field mutation**: Updating `conversation.userId` or `conversation.createdAt` -> `PERMISSION_DENIED`.
11. **Array size abuse**: Creating message with `sources` array length > 10 -> `PERMISSION_DENIED`.
12. **Resource exhaustion / oversized payload**: Creating message with `content.size() > 32000` or design with `svgCode.size() > 64000` -> `PERMISSION_DENIED`.
