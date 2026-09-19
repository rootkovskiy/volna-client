import ExpoModulesCore
import MatrixSDKFFI
import CryptoKit
import Foundation

private let sessionChangedEvent = "onSessionChanged"
private let roomTimelineEvent = "onRoomTimeline"
private let verificationChangedEvent = "onVerificationChanged"
private let safeIdPattern = "^[A-Za-z0-9_-]{8,80}$"
private let safeRoomIdPattern = "^![^\\s:]{1,255}:[^\\s]{1,255}$"
private let volnaMessageType = "social.volna.message.v1"
private let maxContentBytes = 64 * 1024

private final class VolnaClientSessionDelegate: ClientSessionDelegate, @unchecked Sendable {
  private let lock = NSLock()
  private var currentSession: Session
  private let onChanged: (Session) -> Void

  init(initialSession: Session, onChanged: @escaping (Session) -> Void) {
    currentSession = initialSession
    self.onChanged = onChanged
  }

  func retrieveSessionFromKeychain(userId: String) throws -> Session {
    lock.lock()
    defer { lock.unlock() }
    guard currentSession.userId == userId else { throw MatrixNativeError.sessionUserMismatch }
    return currentSession
  }

  func saveSessionInKeychain(session: Session) {
    lock.lock()
    currentSession = session
    lock.unlock()
    onChanged(session)
  }
}

private final class VolnaTimelineListener: TimelineListener, @unchecked Sendable {
  private let update: ([TimelineDiff]) -> Void

  init(update: @escaping ([TimelineDiff]) -> Void) {
    self.update = update
  }

  func onUpdate(diff: [TimelineDiff]) {
    update(diff)
  }
}

private final class VolnaRecoveryProgressListener: EnableRecoveryProgressListener, @unchecked Sendable {
  func onUpdate(status: EnableRecoveryProgress) {}
}

private final class VolnaSessionVerificationDelegate: SessionVerificationControllerDelegate, @unchecked Sendable {
  private let onUpdate: (String, Any?) -> Void

  init(onUpdate: @escaping (String, Any?) -> Void) {
    self.onUpdate = onUpdate
  }

  func didReceiveVerificationRequest(details: SessionVerificationRequestDetails) { onUpdate("request", details) }
  func didAcceptVerificationRequest() { onUpdate("accepted", nil) }
  func didStartSasVerification() { onUpdate("started", nil) }
  func didReceiveVerificationData(data: SessionVerificationData) { onUpdate("data", data) }
  func didFail() { onUpdate("failed", nil) }
  func didCancel() { onUpdate("cancelled", nil) }
  func didFinish() { onUpdate("done", nil) }
}

private final class MatrixVerificationRecord: @unchecked Sendable {
  let id: String
  let initiatedByMe: Bool
  let otherUserId: String
  let otherDeviceId: String?
  let flowId: String?
  var phase = "requested"
  var sasDecimal: [Int]?
  var sasEmoji: [[String]] = []

  init(id: String, initiatedByMe: Bool, otherUserId: String, otherDeviceId: String?, flowId: String?) {
    self.id = id
    self.initiatedByMe = initiatedByMe
    self.otherUserId = otherUserId
    self.otherDeviceId = otherDeviceId
    self.flowId = flowId
  }
}

private final class MatrixTimelineState: @unchecked Sendable {
  private let lock = NSLock()
  private var active = true
  private var items: [TimelineItem] = []
  let timelineId = UUID().uuidString
  private var revision = 0
  private var listenerGeneration = 0
  private var hasMoreHistory = true
  private var paginating = false

  func apply(_ diff: [TimelineDiff], generation: Int) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard active && generation == listenerGeneration else { return false }
    for update in diff {
      switch update {
      case .append(let values): items.append(contentsOf: values)
      case .clear: items.removeAll()
      case .pushFront(let value): items.insert(value, at: 0)
      case .pushBack(let value): items.append(value)
      case .popFront: if !items.isEmpty { items.removeFirst() }
      case .popBack: if !items.isEmpty { items.removeLast() }
      case .insert(let index, let value):
        let position = Int(index)
        if position <= items.count { items.insert(value, at: position) }
      case .set(let index, let value):
        let position = Int(index)
        if items.indices.contains(position) { items[position] = value }
      case .remove(let index):
        let position = Int(index)
        if items.indices.contains(position) { items.remove(at: position) }
      case .truncate(let length):
        if items.count > Int(length) { items.removeLast(items.count - Int(length)) }
      case .reset(let values): items = values
      }
    }
    revision += 1
    return true
  }

  func snapshot() -> (items: [TimelineItem], revision: Int, hasMoreHistory: Bool) {
    lock.lock()
    defer { lock.unlock() }
    return (active ? items : [], revision, hasMoreHistory)
  }

  func beginListener() -> Int {
    lock.lock()
    defer { lock.unlock() }
    listenerGeneration += 1
    return listenerGeneration
  }

  func isCurrentListener(_ generation: Int) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return active && listenerGeneration == generation
  }

  func beginPagination() throws {
    lock.lock()
    defer { lock.unlock() }
    guard active && !paginating else { throw MatrixNativeError.invalidPagination }
    paginating = true
  }

  func endPagination() {
    lock.lock()
    paginating = false
    lock.unlock()
  }

  func setReachedStart(_ reachedStart: Bool) throws {
    lock.lock()
    defer { lock.unlock() }
    guard active else { throw MatrixNativeError.invalidPagination }
    hasMoreHistory = !reachedStart
  }

  func deactivate() {
    lock.lock()
    active = false
    listenerGeneration += 1
    items.removeAll()
    lock.unlock()
  }
}

private final class MatrixRoomHandle: @unchecked Sendable {
  let room: Room
  let timeline: Timeline
  let state: MatrixTimelineState
  var listener: VolnaTimelineListener?
  var listenerTask: TaskHandle?

  init(room: Room, timeline: Timeline, state: MatrixTimelineState) {
    self.room = room
    self.timeline = timeline
    self.state = state
  }
}

private final class MatrixSessionHandle: @unchecked Sendable {
  let client: Client
  let syncService: SyncService
  let sessionDelegate: VolnaClientSessionDelegate
  let verificationController: SessionVerificationController
  let verificationDelegate: VolnaSessionVerificationDelegate
  let userId: String
  let deviceId: String
  private let roomLock = NSLock()
  private let verificationLock = NSLock()
  private var roomHandles: [String: MatrixRoomHandle] = [:]
  private var verificationRecord: MatrixVerificationRecord?

  init(client: Client, syncService: SyncService, sessionDelegate: VolnaClientSessionDelegate, verificationController: SessionVerificationController, verificationDelegate: VolnaSessionVerificationDelegate, userId: String, deviceId: String) {
    self.client = client
    self.syncService = syncService
    self.sessionDelegate = sessionDelegate
    self.verificationController = verificationController
    self.verificationDelegate = verificationDelegate
    self.userId = userId
    self.deviceId = deviceId
  }

  func room(_ roomId: String) -> MatrixRoomHandle? {
    roomLock.lock()
    defer { roomLock.unlock() }
    return roomHandles[roomId]
  }

  func putRoom(_ roomId: String, _ room: MatrixRoomHandle) -> MatrixRoomHandle? {
    roomLock.lock()
    defer { roomLock.unlock() }
    if let existing = roomHandles[roomId] { return existing }
    roomHandles[roomId] = room
    return nil
  }

  func removeRoom(_ roomId: String) -> MatrixRoomHandle? {
    roomLock.lock()
    defer { roomLock.unlock() }
    return roomHandles.removeValue(forKey: roomId)
  }

  func takeRooms() -> [MatrixRoomHandle] {
    roomLock.lock()
    defer { roomLock.unlock() }
    let result = Array(roomHandles.values)
    roomHandles.removeAll()
    return result
  }

  func withVerification<T>(_ body: (MatrixVerificationRecord?) throws -> T) rethrows -> T {
    verificationLock.lock()
    defer { verificationLock.unlock() }
    return try body(verificationRecord)
  }

  func setVerification(_ value: MatrixVerificationRecord?) {
    verificationLock.lock()
    verificationRecord = value
    verificationLock.unlock()
  }

  func updateVerification(_ update: (MatrixVerificationRecord?) -> Void) {
    verificationLock.lock()
    update(verificationRecord)
    verificationLock.unlock()
  }
}

public final class VolnaMatrixNativeModule: Module {
  private let operationQueue = DispatchQueue(label: "social.volna.matrix.session")
  private let handleLock = NSLock()
  private var handles: [String: MatrixSessionHandle] = [:]
  private var activeOperations: Set<String> = []

  public func definition() -> ModuleDefinition {
    Name("VolnaMatrixNative")
    Events(sessionChangedEvent, roomTimelineEvent, verificationChangedEvent)

    Function("getRuntimeInfo") {
      return [
        "available": true,
        "implementation": "matrix-rust-sdk-ffi",
        "bindingVersion": "26.08.11-volna.1",
        "platform": "ios",
        "apiVersion": 1,
        "features": ["session-lifecycle", "room-timeline-v1", "history-pagination-v1", "authenticated-timeline-v1", "strict-room-key-recipients-v1", "recovery-v1", "recovery-key-rotation-v1", "identity-security-v1", "sas-verification-v1"],
      ]
    }

    AsyncFunction("startSession") {
      (accountId: String,
       homeserverUrl: String,
       userId: String,
       deviceId: String,
       accessToken: String,
       refreshToken: String?,
       storeKeyBase64Url: String) async throws -> [String: Any] in
      try Self.validateSessionInput(
        accountId: accountId,
        homeserverUrl: homeserverUrl,
        userId: userId,
        deviceId: deviceId,
        accessToken: accessToken,
        refreshToken: refreshToken
      )
      try self.beginOperation(accountId)
      defer { self.endOperation(accountId) }
      var storeKey = try Self.decodeStoreKey(storeKeyBase64Url)
      defer { storeKey.resetBytes(in: 0..<storeKey.count) }

      try await self.closeHandle(self.removeHandle(accountId), logout: false)
      try Self.ensurePlatformInitialized()
      let normalizedHomeserver = try Self.normalizedHomeserverUrl(homeserverUrl)
      let storeRoot = try self.accountStoreRoot(accountId)
      let dataPath = storeRoot.appendingPathComponent("data", isDirectory: true)
      let cachePath = storeRoot.appendingPathComponent("cache", isDirectory: true)
      try FileManager.default.createDirectory(at: dataPath, withIntermediateDirectories: true)
      try FileManager.default.createDirectory(at: cachePath, withIntermediateDirectories: true)
      let session = Session(
        accessToken: accessToken,
        refreshToken: refreshToken,
        userId: userId,
        deviceId: deviceId,
        homeserverUrl: normalizedHomeserver,
        oauthData: nil,
        slidingSyncVersion: .none
      )
      let sessionDelegate = VolnaClientSessionDelegate(initialSession: session) { [weak self] updated in
        let payload: [String: Any?] = [
          "accountId": accountId,
          "homeserverUrl": updated.homeserverUrl,
          "userId": updated.userId,
          "deviceId": updated.deviceId,
          "accessToken": updated.accessToken,
          "refreshToken": updated.refreshToken ?? NSNull(),
        ]
        self?.sendEvent(sessionChangedEvent, payload)
      }
      var client: Client?
      var syncService: SyncService?
      do {
        let store = SqliteStoreBuilder(dataPath: dataPath.path, cachePath: cachePath.path).key(key: storeKey)
        client = try await ClientBuilder()
          .homeserverUrl(url: normalizedHomeserver)
          .sqliteStore(config: store)
          .roomKeyRecipientStrategy(strategy: .identityBasedStrategy)
          .disableAutomaticTokenRefresh()
          .setSessionDelegate(sessionDelegate: sessionDelegate)
          .build()
        try await client!.restoreSession(session: session)
        guard client!.encryption().roomKeyRecipientPolicyVersion() == 1 else {
          throw MatrixNativeError.recipientPolicyUnavailable
        }
        syncService = try await client!.syncService().finish()
        let verificationController = try await client!.getSessionVerificationController()
        let verificationDelegate = VolnaSessionVerificationDelegate { [weak self] kind, payload in
          self?.applyVerificationUpdate(accountId, kind: kind, payload: payload)
        }
        verificationController.setDelegate(delegate: verificationDelegate)
        let handle = MatrixSessionHandle(
          client: client!,
          syncService: syncService!,
          sessionDelegate: sessionDelegate,
          verificationController: verificationController,
          verificationDelegate: verificationDelegate,
          userId: userId,
          deviceId: deviceId
        )
        self.setHandle(accountId, handle)
        await syncService!.start()
      } catch {
        _ = self.removeHandle(accountId)
        if let syncService { await syncService.stop() }
        client = nil
        syncService = nil
        throw error
      }
      return [
        "accountId": accountId,
        "homeserverUrl": normalizedHomeserver,
        "userId": userId,
        "deviceId": deviceId,
        "running": true,
      ]
    }.runOnQueue(operationQueue)

    AsyncFunction("stopSession") { (accountId: String) async throws in
      try Self.requireSafeId(accountId, label: "account")
      try self.beginOperation(accountId)
      defer { self.endOperation(accountId) }
      try await self.closeHandle(self.removeHandle(accountId), logout: false)
    }.runOnQueue(operationQueue)

    AsyncFunction("logoutSession") { (accountId: String) async throws in
      try Self.requireSafeId(accountId, label: "account")
      try self.beginOperation(accountId)
      defer { self.endOperation(accountId) }
      var logoutError: Error?
      do {
        try await self.closeHandle(self.removeHandle(accountId), logout: true)
      } catch {
        logoutError = error
      }
      do {
        try self.deleteAccountStore(accountId)
      } catch {
        if logoutError == nil { throw error }
      }
      if let logoutError { throw logoutError }
    }.runOnQueue(operationQueue)

    AsyncFunction("listRoomIds") { (accountId: String) async throws -> [String] in
      try Self.requireSafeId(accountId, label: "account")
      return try self.requireHandle(accountId).client.rooms()
        .map { $0.id() }
        .filter { Self.isRoomId($0) }
        .reduce(into: [String]()) { result, roomId in
          if !result.contains(roomId), result.count < 512 { result.append(roomId) }
        }
    }.runOnQueue(operationQueue)

    AsyncFunction("bindRoomKeyRecipients") { (accountId: String, roomId: String, peerId: String) async throws in
      try Self.requireSafeId(accountId, label: "account")
      try Self.requireRoomId(roomId)
      try Self.requireMatrixUserId(peerId)
      let encryption = try self.requireHandle(accountId).client.encryption()
      guard encryption.roomKeyRecipientPolicyVersion() == 1 else { throw MatrixNativeError.recipientPolicyUnavailable }
      try await encryption.bindRoomKeyRecipients(roomId: roomId, peerId: peerId)
    }.runOnQueue(operationQueue)

    AsyncFunction("openRoom") { (accountId: String, roomId: String) async throws -> [String: Any] in
      try Self.requireSafeId(accountId, label: "account")
      try Self.requireRoomId(roomId)
      let session = try self.requireHandle(accountId)
      if let existing = session.room(roomId) { return self.roomSnapshot(accountId, roomId, existing) }

      let room: Room
      if let existing = try session.client.getRoom(roomId: roomId) {
        room = existing
      } else {
        room = try await session.client.joinRoomById(roomId: roomId)
      }
      if room.membership() == .invited { try await room.join() }
      guard room.membership() == .joined else { throw MatrixNativeError.roomNotJoined }
      guard await room.isEncrypted() else { throw MatrixNativeError.roomNotEncrypted }
      room.enableSendQueue(enable: true)
      let timeline = try await room.timeline()
      let state = MatrixTimelineState()
      let created = MatrixRoomHandle(room: room, timeline: timeline, state: state)
      if let raced = session.putRoom(roomId, created) {
        self.closeRoomHandle(created)
        return self.roomSnapshot(accountId, roomId, raced)
      }
      do {
        let reachedStart = try await timeline.paginateBackwards(numEvents: 100)
        try state.setReachedStart(reachedStart)
        await self.refreshTimelineListener(accountId, roomId, created)
        return self.roomSnapshot(accountId, roomId, created)
      } catch {
        _ = session.removeRoom(roomId)
        self.closeRoomHandle(created)
        throw error
      }
    }.runOnQueue(operationQueue)

    AsyncFunction("paginateRoom") { (accountId: String, roomId: String, limit: Int) async throws -> [String: Any] in
      try Self.requireSafeId(accountId, label: "account")
      try Self.requireRoomId(roomId)
      guard (1...200).contains(limit) else { throw MatrixNativeError.invalidPagination }
      let room = try self.requireRoomHandle(accountId, roomId)
      try room.state.beginPagination()
      defer { room.state.endPagination() }
      if room.state.snapshot().hasMoreHistory {
        let reachedStart = try await room.timeline.paginateBackwards(numEvents: UInt16(limit))
        try room.state.setReachedStart(reachedStart)
        await self.refreshTimelineListener(accountId, roomId, room)
      }
      return self.roomSnapshot(accountId, roomId, room)
    }.runOnQueue(operationQueue)

    AsyncFunction("sendMessage") { (accountId: String, roomId: String, contentJson: String) async throws in
      try Self.requireSafeId(accountId, label: "account")
      try Self.requireRoomId(roomId)
      let content = try Self.validateMessageContent(contentJson)
      let room = try self.requireRoomHandle(accountId, roomId)
      guard let body = content["body"] as? String,
            let message = room.timeline.createMessageContent(msgType: .other(msgtype: volnaMessageType, body: body)) else {
        throw MatrixNativeError.invalidMessageContent
      }
      let extra: [String: Any] = [
        "social.volna.content": content["social.volna.content"] as Any,
        "social.volna.device_id": content["social.volna.device_id"] as Any,
      ]
      let extraData = try JSONSerialization.data(withJSONObject: extra, options: [.sortedKeys])
      guard let extraJson = String(data: extraData, encoding: .utf8) else { throw MatrixNativeError.invalidMessageContent }
      _ = try await room.timeline.sendWithExtraContent(msg: message, extraContentJson: extraJson)
    }.runOnQueue(operationQueue)

    AsyncFunction("closeRoom") { (accountId: String, roomId: String) async throws in
      try Self.requireSafeId(accountId, label: "account")
      try Self.requireRoomId(roomId)
      self.closeRoomHandle(try self.requireHandle(accountId).removeRoom(roomId))
    }.runOnQueue(operationQueue)

    AsyncFunction("setupRecovery") { (accountId: String) async throws -> String in
      try Self.requireSafeId(accountId, label: "account")
      let encryption = try self.requireHandle(accountId).client.encryption()
      guard encryption.recoveryState() != .enabled else { throw MatrixNativeError.recoveryAlreadyEnabled }
      let recoveryKey = try await encryption.enableRecovery(
        waitForBackupsToUpload: true,
        passphrase: nil,
        progressListener: VolnaRecoveryProgressListener()
      )
      guard (32...512).contains(recoveryKey.count) else { throw MatrixNativeError.invalidRecoveryKey }
      return recoveryKey
    }.runOnQueue(operationQueue)

    AsyncFunction("resetRecovery") { (accountId: String) async throws -> String in
      try Self.requireSafeId(accountId, label: "account")
      let encryption = try self.requireHandle(accountId).client.encryption()
      guard encryption.verificationState() == .verified, encryption.recoveryState() == .enabled else {
        throw MatrixNativeError.recoveryResetUnavailable
      }
      let recoveryKey = try await encryption.resetRecoveryKey()
      guard (32...512).contains(recoveryKey.count) else { throw MatrixNativeError.invalidRecoveryKey }
      return recoveryKey
    }.runOnQueue(operationQueue)

    AsyncFunction("recoverSecurity") { (accountId: String, recoveryKey: String) async throws in
      try Self.requireSafeId(accountId, label: "account")
      guard (32...512).contains(recoveryKey.count), recoveryKey == recoveryKey.trimmingCharacters(in: .whitespacesAndNewlines) else {
        throw MatrixNativeError.invalidRecoveryKey
      }
      let encryption = try self.requireHandle(accountId).client.encryption()
      try await encryption.recover(recoveryKey: recoveryKey)
      await encryption.waitForE2eeInitializationTasks()
    }.runOnQueue(operationQueue)

    AsyncFunction("getSecurityState") { (accountId: String, userIds: [String]) async throws -> [String: Any] in
      try Self.requireSafeId(accountId, label: "account")
      guard (1...4).contains(userIds.count) else { throw MatrixNativeError.invalidIdentityQuery }
      let handle = try self.requireHandle(accountId)
      let encryption = handle.client.encryption()
      var identities: [[String: Any]] = []
      for userId in Array(Set(userIds)).sorted() {
        try Self.requireMatrixUserId(userId)
        guard Self.matrixDomain(userId) == Self.matrixDomain(handle.userId) else { throw MatrixNativeError.identityUserMismatch }
        let identity = try await encryption.userIdentity(userId: userId, fallbackToServer: true)
        identities.append([
          "userId": userId,
          "masterKey": identity?.masterKey().map { $0 as Any } ?? NSNull(),
          "verified": identity?.isVerified() == true,
          "changed": identity?.hasVerificationViolation() == true,
        ])
      }
      let pending = handle.withVerification { record in
        record.map { Self.verificationSnapshot($0) as Any } ?? NSNull()
      }
      let ed25519 = await encryption.ed25519Key()
      let curve25519 = await encryption.curve25519Key()
      return [
        "cryptoVersion": "matrix-rust-sdk-ffi/26.08.11",
        "crossSigningReady": encryption.verificationState() == .verified,
        "secretStorageReady": encryption.recoveryState() == .enabled,
        "currentDevice": [
          "userId": handle.userId,
          "deviceId": handle.deviceId,
          "ed25519": ed25519.map { $0 as Any } ?? NSNull(),
          "curve25519": curve25519.map { $0 as Any } ?? NSNull(),
        ],
        "identities": identities,
        "pendingVerification": pending,
      ]
    }.runOnQueue(operationQueue)

    AsyncFunction("startDeviceVerification") { (accountId: String, userId: String, deviceId: String) async throws -> [String: Any] in
      try Self.requireSafeId(accountId, label: "account")
      try Self.requireMatrixUserId(userId)
      try Self.requireSafeId(deviceId, label: "device")
      let handle = try self.requireHandle(accountId)
      guard Self.matrixDomain(userId) == Self.matrixDomain(handle.userId) else { throw MatrixNativeError.verificationUserMismatch }
      let active = handle.withVerification { record in
        record != nil && record?.phase != "cancelled" && record?.phase != "done"
      }
      guard !active else { throw MatrixNativeError.verificationAlreadyActive }
      let record = MatrixVerificationRecord(
        id: "mxverify_\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))",
        initiatedByMe: true,
        otherUserId: userId,
        otherDeviceId: deviceId,
        flowId: nil
      )
      handle.setVerification(record)
      do {
        try await handle.verificationController.requestUserVerification(userId: userId)
        self.emitVerification(accountId, handle)
        return Self.verificationSnapshot(record)
      } catch {
        handle.setVerification(nil)
        throw error
      }
    }.runOnQueue(operationQueue)

    AsyncFunction("acceptVerification") { (accountId: String, verificationId: String) async throws -> [String: Any] in
      let (handle, record) = try self.requireVerification(accountId, verificationId)
      guard !record.initiatedByMe, let flowId = record.flowId else { throw MatrixNativeError.verificationNotAcceptable }
      try await handle.verificationController.acknowledgeVerificationRequest(senderId: record.otherUserId, flowId: flowId)
      try await handle.verificationController.acceptVerificationRequest()
      handle.updateVerification { $0?.phase = "ready" }
      self.emitVerification(accountId, handle)
      return Self.verificationSnapshot(record)
    }.runOnQueue(operationQueue)

    AsyncFunction("startSasVerification") { (accountId: String, verificationId: String) async throws -> [String: Any] in
      let (handle, record) = try self.requireVerification(accountId, verificationId)
      guard ["requested", "ready"].contains(record.phase) else { throw MatrixNativeError.verificationNotReady }
      try await handle.verificationController.startSasVerification()
      handle.updateVerification { $0?.phase = "started" }
      self.emitVerification(accountId, handle)
      return Self.verificationSnapshot(record)
    }.runOnQueue(operationQueue)

    AsyncFunction("confirmVerification") { (accountId: String, verificationId: String) async throws -> [String: Any] in
      let (handle, record) = try self.requireVerification(accountId, verificationId)
      guard !record.sasEmoji.isEmpty || record.sasDecimal != nil else { throw MatrixNativeError.verificationNotReady }
      try await handle.verificationController.approveVerification()
      return Self.verificationSnapshot(record)
    }.runOnQueue(operationQueue)

    AsyncFunction("mismatchVerification") { (accountId: String, verificationId: String) async throws -> [String: Any] in
      let (handle, record) = try self.requireVerification(accountId, verificationId)
      try await handle.verificationController.declineVerification()
      handle.updateVerification { $0?.phase = "cancelled" }
      self.emitVerification(accountId, handle)
      return Self.verificationSnapshot(record)
    }.runOnQueue(operationQueue)

    AsyncFunction("cancelVerification") { (accountId: String, verificationId: String) async throws -> [String: Any] in
      let (handle, record) = try self.requireVerification(accountId, verificationId)
      try await handle.verificationController.cancelVerification()
      handle.updateVerification { $0?.phase = "cancelled" }
      self.emitVerification(accountId, handle)
      return Self.verificationSnapshot(record)
    }.runOnQueue(operationQueue)

    OnDestroy {
      self.handleLock.lock()
      let handles = Array(self.handles.values)
      self.handles.removeAll()
      self.activeOperations.removeAll()
      self.handleLock.unlock()
      for handle in handles {
        handle.takeRooms().forEach(self.closeRoomHandle)
        Task { await handle.syncService.stop() }
      }
    }
  }

  private func removeHandle(_ accountId: String) -> MatrixSessionHandle? {
    handleLock.lock()
    defer { handleLock.unlock() }
    return handles.removeValue(forKey: accountId)
  }

  private func beginOperation(_ accountId: String) throws {
    handleLock.lock()
    defer { handleLock.unlock() }
    guard !activeOperations.contains(accountId) else { throw MatrixNativeError.operationInProgress }
    activeOperations.insert(accountId)
  }

  private func endOperation(_ accountId: String) {
    handleLock.lock()
    activeOperations.remove(accountId)
    handleLock.unlock()
  }

  private func setHandle(_ accountId: String, _ handle: MatrixSessionHandle) {
    handleLock.lock()
    handles[accountId] = handle
    handleLock.unlock()
  }

  private func requireHandle(_ accountId: String) throws -> MatrixSessionHandle {
    handleLock.lock()
    defer { handleLock.unlock() }
    guard let handle = handles[accountId] else { throw MatrixNativeError.sessionNotRunning }
    return handle
  }

  private func requireRoomHandle(_ accountId: String, _ roomId: String) throws -> MatrixRoomHandle {
    guard let room = try requireHandle(accountId).room(roomId) else { throw MatrixNativeError.roomNotOpen }
    return room
  }

  private func requireVerification(_ accountId: String, _ verificationId: String) throws -> (MatrixSessionHandle, MatrixVerificationRecord) {
    try Self.requireSafeId(accountId, label: "account")
    try Self.requireSafeId(verificationId, label: "verification")
    let handle = try requireHandle(accountId)
    guard let record = handle.withVerification({ $0 }), record.id == verificationId else {
      throw MatrixNativeError.verificationNotFound
    }
    return (handle, record)
  }

  private func applyVerificationUpdate(_ accountId: String, kind: String, payload: Any?) {
    guard let handle = try? requireHandle(accountId) else { return }
    if kind == "request", let details = payload as? SessionVerificationRequestDetails {
      guard Self.isMatrixUserId(details.senderProfile.userId),
            Self.matrixDomain(details.senderProfile.userId) == Self.matrixDomain(handle.userId),
            Self.isSafeId(details.deviceId), !details.flowId.isEmpty, details.flowId.count <= 512 else { return }
      handle.setVerification(MatrixVerificationRecord(
        id: "mxverify_\(Self.sha256("\(details.senderProfile.userId)\u{0}\(details.flowId)").prefix(40))",
        initiatedByMe: false,
        otherUserId: details.senderProfile.userId,
        otherDeviceId: details.deviceId,
        flowId: details.flowId
      ))
    } else {
      handle.updateVerification { record in
        guard let record else { return }
        switch kind {
        case "accepted": record.phase = "ready"
        case "started": record.phase = "started"
        case "data":
          guard let data = payload as? SessionVerificationData else { return }
          switch data {
          case .decimals(let values):
            if values.count == 3 { record.sasDecimal = values.map(Int.init) }
          case .emojis(let emojis, _):
            let values = emojis.map { [$0.symbol(), $0.description()] }
            if values.count == 7 { record.sasEmoji = values }
          }
          record.phase = "started"
        case "done": record.phase = "done"
        case "cancelled", "failed": record.phase = "cancelled"
        default: break
        }
      }
    }
    emitVerification(accountId, handle)
  }

  private func emitVerification(_ accountId: String, _ handle: MatrixSessionHandle) {
    guard let value = handle.withVerification({ $0.map(Self.verificationSnapshot) }) else { return }
    sendEvent(verificationChangedEvent, ["accountId": accountId, "verification": value])
  }

  private func closeHandle(_ handle: MatrixSessionHandle?, logout: Bool) async throws {
    guard let handle else { return }
    handle.takeRooms().forEach(closeRoomHandle)
    await handle.syncService.stop()
    if logout { try await handle.client.logout() }
  }

  private func closeRoomHandle(_ handle: MatrixRoomHandle?) {
    guard let handle else { return }
    handle.state.deactivate()
    handle.listenerTask?.cancel()
    handle.listenerTask = nil
  }

  private func roomSnapshot(_ accountId: String, _ roomId: String, _ handle: MatrixRoomHandle) -> [String: Any] {
    roomSnapshot(accountId, roomId, handle.state)
  }

  private func roomSnapshot(_ accountId: String, _ roomId: String, _ state: MatrixTimelineState) -> [String: Any] {
    let snapshot = state.snapshot()
    let items = snapshot.items
    let events = items.compactMap { Self.timelineEvent($0) }
    let unavailable = items.contains { $0.asEvent()?.eventTypeRaw == "m.room.encrypted" }
    return ["accountId": accountId, "roomId": roomId, "events": events, "hasUndecryptableEvents": unavailable,
      "timelineId": state.timelineId, "revision": snapshot.revision, "hasMoreHistory": snapshot.hasMoreHistory]
  }

  // The FFI delivers the current complete Reset before addListener returns.
  // This settles pagination before JS restores its reading anchor. A generation
  // fence rejects callbacks already queued by the retired subscription.
  private func refreshTimelineListener(_ accountId: String, _ roomId: String, _ handle: MatrixRoomHandle) async {
    let state = handle.state
    let generation = state.beginListener()
    handle.listenerTask?.cancel()
    let listener = VolnaTimelineListener { [weak self, weak state] diff in
      guard let self, let state, state.apply(diff, generation: generation) else { return }
      let payload = self.roomSnapshot(accountId, roomId, state)
      DispatchQueue.main.async { [weak self] in self?.sendEvent(roomTimelineEvent, payload) }
    }
    handle.listener = listener
    let task = await handle.timeline.addListener(listener: listener)
    if state.isCurrentListener(generation) { handle.listenerTask = task }
    else { task.cancel() }
  }

  private static func timelineEvent(_ item: TimelineItem) -> [String: Any]? {
    guard let event = item.asEvent(), event.eventTypeRaw == "m.room.message" else { return nil }
    // Only the sender's signed identity is required; a personal SAS comparison
    // is optional. Every other authenticity failure (including SentInClear)
    // stays out of the protected projection.
    switch event.lazyProvider.getShields(strict: true) {
    case .none: break
    case .red(let code), .grey(let code):
      guard code == .unverifiedIdentity else { return nil }
    }
    let eventId: String
    switch event.eventOrTransactionId {
    case .eventId(let value): eventId = value
    case .transactionId: return nil
    }
    guard let raw = event.lazyProvider.debugInfo().originalJson, raw.utf8.count <= maxContentBytes * 2,
          let rawData = raw.data(using: .utf8),
          let parsed = try? JSONSerialization.jsonObject(with: rawData) as? [String: Any],
          let content = parsed["content"] as? [String: Any],
          let contentData = try? JSONSerialization.data(withJSONObject: content, options: [.sortedKeys]),
          let contentJson = String(data: contentData, encoding: .utf8) else { return nil }
    return [
      "authenticated": true,
      "eventId": eventId,
      "senderUserId": event.sender,
      "timestamp": event.timestamp,
      "contentJson": contentJson,
    ]
  }

  private func accountStoreRoot(_ accountId: String) throws -> URL {
    let applicationSupport = try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    let root = applicationSupport.appendingPathComponent("volna-matrix", isDirectory: true).standardizedFileURL
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
      ofItemAtPath: root.path
    )
    var resourceValues = URLResourceValues()
    resourceValues.isExcludedFromBackup = true
    var mutableRoot = root
    try mutableRoot.setResourceValues(resourceValues)
    let target = root.appendingPathComponent(Self.sha256(accountId), isDirectory: true).standardizedFileURL
    guard target.deletingLastPathComponent() == root else { throw MatrixNativeError.unsafeStorePath }
    try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
    return target
  }

  private func deleteAccountStore(_ accountId: String) throws {
    let target = try accountStoreRoot(accountId)
    let root = target.deletingLastPathComponent().standardizedFileURL
    guard root.lastPathComponent == "volna-matrix", target.deletingLastPathComponent() == root else {
      throw MatrixNativeError.unsafeStorePath
    }
    if FileManager.default.fileExists(atPath: target.path) {
      try FileManager.default.removeItem(at: target)
    }
  }

  private static let platformLock = NSLock()
  private static var platformInitialized = false

  private static func ensurePlatformInitialized() throws {
    platformLock.lock()
    defer { platformLock.unlock() }
    if platformInitialized { return }
    try initPlatform(
      config: TracingConfiguration(
        logLevel: .warn,
        traceLogPacks: [],
        extraTargets: [],
        writeToStdoutOrSystem: false,
        writeToFiles: nil,
        sentryConfig: nil
      ),
      useLightweightTokioRuntime: false
    )
    platformInitialized = true
  }

  private static func validateSessionInput(
    accountId: String,
    homeserverUrl: String,
    userId: String,
    deviceId: String,
    accessToken: String,
    refreshToken: String?
  ) throws {
    try requireSafeId(accountId, label: "account")
    try requireSafeId(deviceId, label: "device")
    guard userId.range(of: "^@[a-z0-9._=/\\-]+:[a-z0-9.-]+(?::[0-9]+)?$", options: .regularExpression) != nil else {
      throw MatrixNativeError.invalidUserId
    }
    guard !accessToken.isEmpty, accessToken.count <= 4096 else { throw MatrixNativeError.invalidAccessToken }
    if let refreshToken, refreshToken.isEmpty || refreshToken.count > 4096 {
      throw MatrixNativeError.invalidRefreshToken
    }
    _ = try normalizedHomeserverUrl(homeserverUrl)
  }

  private static func requireSafeId(_ value: String, label: String) throws {
    guard isSafeId(value) else {
      throw MatrixNativeError.invalidIdentifier(label)
    }
  }

  private static func isSafeId(_ value: String) -> Bool {
    value.range(of: safeIdPattern, options: .regularExpression) != nil
  }

  private static func isMatrixUserId(_ value: String) -> Bool {
    value.range(of: "^@[a-z0-9._=/\\-]+:[a-z0-9.-]+(?::[0-9]+)?$", options: .regularExpression) != nil
  }

  private static func requireMatrixUserId(_ value: String) throws {
    guard isMatrixUserId(value) else { throw MatrixNativeError.invalidUserId }
  }

  private static func matrixDomain(_ value: String) -> String {
    guard let separator = value.firstIndex(of: ":") else { return "" }
    return String(value[value.index(after: separator)...])
  }

  private static func verificationSnapshot(_ record: MatrixVerificationRecord) -> [String: Any] {
    [
      "id": record.id,
      "phase": record.phase,
      "initiatedByMe": record.initiatedByMe,
      "otherUserId": record.otherUserId,
      "otherDeviceId": record.otherDeviceId.map { $0 as Any } ?? NSNull(),
      "sasDecimal": record.sasDecimal.map { $0 as Any } ?? NSNull(),
      "sasEmoji": record.sasEmoji,
      "qrCodeBase64": NSNull(),
      "qrSupported": false,
    ]
  }

  private static func isRoomId(_ value: String) -> Bool {
    value.range(of: safeRoomIdPattern, options: .regularExpression) != nil
  }

  private static func requireRoomId(_ value: String) throws {
    guard isRoomId(value) else { throw MatrixNativeError.invalidRoomId }
  }

  private static func validateMessageContent(_ value: String) throws -> [String: Any] {
    guard !value.isEmpty, value.utf8.count <= maxContentBytes,
          let data = value.data(using: .utf8),
          let content = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(content.keys) == Set(["msgtype", "body", "social.volna.content", "social.volna.device_id"]),
          content["msgtype"] as? String == volnaMessageType,
          let body = content["body"] as? String, !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          body.count <= 1000, content["social.volna.content"] is [String: Any],
          let deviceId = content["social.volna.device_id"] as? String,
          deviceId.range(of: safeIdPattern, options: .regularExpression) != nil else {
      throw MatrixNativeError.invalidMessageContent
    }
    return content
  }

  private static func normalizedHomeserverUrl(_ value: String) throws -> String {
    guard let components = URLComponents(string: value), let scheme = components.scheme?.lowercased(),
          let host = components.host?.lowercased(), components.user == nil, components.password == nil else {
      throw MatrixNativeError.invalidHomeserver
    }
    guard scheme == "https" || (scheme == "http" && ["localhost", "127.0.0.1"].contains(host)) else {
      throw MatrixNativeError.invalidHomeserver
    }
    var origin = URLComponents()
    origin.scheme = scheme
    origin.host = host
    origin.port = components.port
    guard let normalized = origin.url?.absoluteString else { throw MatrixNativeError.invalidHomeserver }
    return normalized
  }

  private static func decodeStoreKey(_ value: String) throws -> Data {
    guard value.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else {
      throw MatrixNativeError.invalidStoreKey
    }
    var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    base64.append(String(repeating: "=", count: (4 - base64.count % 4) % 4))
    guard let decoded = Data(base64Encoded: base64), decoded.count == 32 else {
      throw MatrixNativeError.invalidStoreKey
    }
    return decoded
  }

  private static func sha256(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }
}

private enum MatrixNativeError: LocalizedError {
  case recipientPolicyUnavailable
  case invalidIdentifier(String)
  case invalidUserId
  case invalidAccessToken
  case invalidRefreshToken
  case invalidHomeserver
  case invalidStoreKey
  case invalidRoomId
  case invalidPagination
  case invalidMessageContent
  case unsafeStorePath
  case operationInProgress
  case sessionUserMismatch
  case sessionNotRunning
  case roomNotJoined
  case roomNotEncrypted
  case roomNotOpen
  case invalidRecoveryKey
  case recoveryAlreadyEnabled
  case recoveryResetUnavailable
  case invalidIdentityQuery
  case verificationAlreadyActive
  case verificationNotAcceptable
  case verificationNotReady
  case verificationNotFound
  case identityUserMismatch
  case verificationUserMismatch

  var errorDescription: String? {
    switch self {
    case .recipientPolicyUnavailable: return "Matrix recipient policy is unavailable"
    case .invalidIdentifier(let label): return "Invalid Matrix \(label) id"
    case .invalidUserId: return "Invalid Matrix user id"
    case .invalidAccessToken: return "Invalid Matrix access token"
    case .invalidRefreshToken: return "Invalid Matrix refresh token"
    case .invalidHomeserver: return "Matrix homeserver requires HTTPS"
    case .invalidStoreKey: return "Matrix store key must contain 32 bytes"
    case .invalidRoomId: return "Invalid Matrix room id"
    case .invalidPagination: return "Invalid Matrix pagination limit"
    case .invalidMessageContent: return "Invalid VOLNA Matrix message content"
    case .unsafeStorePath: return "Unsafe Matrix store path"
    case .operationInProgress: return "Matrix session operation is already in progress"
    case .sessionUserMismatch: return "Matrix session user mismatch"
    case .sessionNotRunning: return "Matrix session is not running"
    case .roomNotJoined: return "Matrix room membership is not joined"
    case .roomNotEncrypted: return "Matrix room is not encrypted"
    case .roomNotOpen: return "Matrix room is not open"
    case .invalidRecoveryKey: return "Invalid Matrix recovery key"
    case .recoveryAlreadyEnabled: return "Matrix recovery is already enabled"
    case .recoveryResetUnavailable: return "Use a verified device with available recovery secrets"
    case .invalidIdentityQuery: return "Invalid Matrix identity query"
    case .verificationAlreadyActive: return "A Matrix verification is already active"
    case .verificationNotAcceptable: return "Matrix verification cannot be accepted"
    case .verificationNotReady: return "Matrix SAS verification is not ready"
    case .verificationNotFound: return "Matrix verification request was not found"
    case .identityUserMismatch: return "Matrix identity user domain mismatch"
    case .verificationUserMismatch: return "Matrix verification user domain mismatch"
    }
  }
}
