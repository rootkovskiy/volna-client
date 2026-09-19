package social.volna.matrix

import android.net.Uri
import android.util.Base64
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.matrix.rustcomponents.sdk.Client
import org.matrix.rustcomponents.sdk.ClientBuilder
import org.matrix.rustcomponents.sdk.ClientSessionDelegate
import org.matrix.rustcomponents.sdk.EventOrTransactionId
import org.matrix.rustcomponents.sdk.EnableRecoveryProgress
import org.matrix.rustcomponents.sdk.EnableRecoveryProgressListener
import org.matrix.rustcomponents.sdk.LogLevel
import org.matrix.rustcomponents.sdk.Membership
import org.matrix.rustcomponents.sdk.MessageType
import org.matrix.rustcomponents.sdk.Room
import org.matrix.rustcomponents.sdk.RecoveryState
import org.matrix.rustcomponents.sdk.Session
import org.matrix.rustcomponents.sdk.SessionVerificationController
import org.matrix.rustcomponents.sdk.SessionVerificationControllerDelegate
import org.matrix.rustcomponents.sdk.SessionVerificationData
import org.matrix.rustcomponents.sdk.SessionVerificationRequestDetails
import org.matrix.rustcomponents.sdk.SlidingSyncVersion
import org.matrix.rustcomponents.sdk.SlidingSyncVersionBuilder
import org.matrix.rustcomponents.sdk.ShieldState
import org.matrix.rustcomponents.sdk.SqliteStoreBuilder
import org.matrix.rustcomponents.sdk.SyncService
import org.matrix.rustcomponents.sdk.TaskHandle
import org.matrix.rustcomponents.sdk.Timeline
import org.matrix.rustcomponents.sdk.TimelineDiff
import org.matrix.rustcomponents.sdk.TimelineItem
import org.matrix.rustcomponents.sdk.TimelineListener
import org.matrix.rustcomponents.sdk.TracingConfiguration
import org.matrix.rustcomponents.sdk.initPlatform
import uniffi.matrix_sdk_crypto.CollectStrategy
import uniffi.matrix_sdk_ui.TimelineEventShieldStateCode

private const val SESSION_CHANGED_EVENT = "onSessionChanged"
private const val ROOM_TIMELINE_EVENT = "onRoomTimeline"
private const val VERIFICATION_CHANGED_EVENT = "onVerificationChanged"
private const val VOLNA_MESSAGE_TYPE = "social.volna.message.v1"
private const val MAX_CONTENT_BYTES = 64 * 1024
private val safeId = Regex("^[A-Za-z0-9_-]{8,80}$")
private val safeRoomId = Regex("^![^\\s:]{1,255}:[^\\s]{1,255}$")

private data class MatrixSessionHandle(
  val client: Client,
  val syncService: SyncService,
  val sessionDelegate: VolnaClientSessionDelegate,
  val verificationController: SessionVerificationController,
  var verificationDelegate: VolnaSessionVerificationDelegate,
  val userId: String,
  val deviceId: String,
  val generation: String,
  val rooms: ConcurrentHashMap<String, MatrixRoomHandle> = ConcurrentHashMap(),
  val roomSubscriptionsMutex: Mutex = Mutex(),
  val verificationLock: Any = Any(),
  val verificationMutex: Mutex = Mutex(),
  var verification: MatrixVerificationRecord? = null,
)

private data class MatrixVerificationRecord(
  val id: String,
  val initiatedByMe: Boolean,
  val otherUserId: String,
  val otherDeviceId: String?,
  val flowId: String?,
  var phase: String = "requested",
  var sasDecimal: List<Int>? = null,
  var sasEmoji: List<List<String>> = emptyList(),
  var qrCodeBase64: String? = null,
  var qrNeedsConfirmation: Boolean = false,
)

private data class MatrixRoomHandle(
  val room: Room,
  val timeline: Timeline,
  var listenerTask: TaskHandle?,
  val items: MutableList<TimelineItem>,
  val timelineId: String = UUID.randomUUID().toString(),
  val paginationMutex: Mutex = Mutex(),
  var revision: Long = 0,
  var listenerGeneration: Long = 0,
  var hasMoreHistory: Boolean = true,
  var active: Boolean = true,
)

private object VolnaRecoveryProgressListener : EnableRecoveryProgressListener {
  override fun onUpdate(status: EnableRecoveryProgress) = Unit
}

private class VolnaSessionVerificationDelegate(
  private val onUpdate: (String, Any?) -> Unit,
) : SessionVerificationControllerDelegate {
  override fun didReceiveVerificationRequest(details: SessionVerificationRequestDetails) = onUpdate("request", details)
  override fun didAcceptVerificationRequest() = onUpdate("accepted", null)
  override fun didStartSasVerification() = onUpdate("started", null)
  override fun didReceiveVerificationData(data: SessionVerificationData) = onUpdate("data", data)
  override fun didFail() = onUpdate("failed", null)
  override fun didCancel() = onUpdate("cancelled", null)
  override fun didFinish() = onUpdate("done", null)
}

private class VolnaClientSessionDelegate(
  initialSession: Session,
  private val onChanged: (Session) -> Unit,
) : ClientSessionDelegate {
  @Volatile
  private var currentSession = initialSession

  override fun retrieveSessionFromKeychain(userId: String): Session {
    require(currentSession.userId == userId) { "Matrix session user mismatch" }
    return currentSession
  }

  override fun saveSessionInKeychain(session: Session) {
    currentSession = session
    onChanged(session)
  }
}

class VolnaMatrixNativeModule : Module() {
  private val handles = ConcurrentHashMap<String, MatrixSessionHandle>()
  private val sessionMutex = Mutex()

  override fun definition() = ModuleDefinition {
    Name("VolnaMatrixNative")
    Events(SESSION_CHANGED_EVENT, ROOM_TIMELINE_EVENT, VERIFICATION_CHANGED_EVENT)

    Function("getRuntimeInfo") {
      mapOf(
        "available" to true,
        "implementation" to "matrix-rust-sdk-ffi",
        "bindingVersion" to "26.08.13-volna.1",
        "platform" to "android",
        "apiVersion" to 1,
        "features" to listOf("session-lifecycle", "room-timeline-v1", "history-pagination-v1", "authenticated-timeline-v1", "strict-room-key-recipients-v1", "authenticated-backup-v1", "recovery-v1", "recovery-key-rotation-v1", "identity-security-v1", "sas-verification-v1", "qr-verification-v1"),
      )
    }

    AsyncFunction("startSession") Coroutine {
      accountId: String,
      homeserverUrl: String,
      userId: String,
      deviceId: String,
      accessToken: String,
      refreshToken: String?,
      storeKeyBase64Url: String,
      ->
      sessionMutex.withLock {
        validateSessionInput(accountId, homeserverUrl, userId, deviceId, accessToken, refreshToken)
        val storeKey = decodeStoreKey(storeKeyBase64Url)
        try {
          closeHandle(handles.remove(accountId), logout = false)
          ensurePlatformInitialized()
          val storeRoot = accountStoreRoot(accountId)
          val dataPath = File(storeRoot, "data").apply { mkdirs() }
          val cachePath = File(storeRoot, "cache").apply { mkdirs() }
          val initialSession = Session(
            accessToken,
            refreshToken,
            userId,
            deviceId,
            normalizedHomeserverUrl(homeserverUrl),
            null,
            // SyncService uses native sliding sync. Restoring NONE overrides
            // the builder's choice and prevents even an existing store opening.
            SlidingSyncVersion.NATIVE,
          )
          val generation = UUID.randomUUID().toString()
          val sessionDelegate = VolnaClientSessionDelegate(initialSession) { session ->
            if (handles[accountId]?.generation == generation) {
              sendEvent(SESSION_CHANGED_EVENT, sessionEvent(accountId, session))
            }
          }
          var clientToClose: Client? = null
          var syncServiceToClose: SyncService? = null
          try {
            val store = SqliteStoreBuilder(dataPath.canonicalPath, cachePath.canonicalPath).key(storeKey)
            val startedClient = ClientBuilder()
              .homeserverUrl(normalizedHomeserverUrl(homeserverUrl))
              .slidingSyncVersionBuilder(SlidingSyncVersionBuilder.DISCOVER_NATIVE)
              .sqliteStore(store)
              .roomKeyRecipientStrategy(CollectStrategy.IDENTITY_BASED_STRATEGY)
              // The pinned SDK first queries the existing identity and only
              // bootstraps if none exists. It never resets an existing identity.
              .autoEnableCrossSigning(true)
              .disableAutomaticTokenRefresh()
              .setSessionDelegate(sessionDelegate)
              .build()
            clientToClose = startedClient
            startedClient.restoreSession(initialSession)
            startedClient.encryption().use { encryption ->
              require(encryption.roomKeyRecipientPolicyVersion() == 1u) { "Matrix recipient policy is unavailable" }
              require(encryption.authenticatedBackupVersion() == 1u) { "Matrix authenticated backup is unavailable" }
              // The verification controller needs the own public identity.
              // Restore starts its initialization asynchronously, including on
              // the first installation; do not race it or create recovery here.
              withTimeout(45_000L) { encryption.waitForE2eeInitializationTasks() }
              // Reuse existing recovery secrets; no identity/key rotation or
              // deletion of earlier backups. Fresh devices have no secret yet.
              withTimeout(60_000L) { encryption.upgradeAuthenticatedBackup(false) }
            }
            val startedSyncService = startedClient.syncService().finish()
            syncServiceToClose = startedSyncService
            val verificationController = startedClient.getSessionVerificationController()
            val verificationDelegate = VolnaSessionVerificationDelegate { kind, payload ->
              applyVerificationUpdate(accountId, generation, null, kind, payload)
            }
            verificationController.setDelegate(verificationDelegate)
            val sessionHandle = MatrixSessionHandle(
              startedClient,
              startedSyncService,
              sessionDelegate,
              verificationController,
              verificationDelegate,
              userId,
              deviceId,
              generation,
            )
            handles[accountId] = sessionHandle
            startedSyncService.start()
          } catch (error: Throwable) {
            handles.remove(accountId)
            runCatching { syncServiceToClose?.close() }
            runCatching { clientToClose?.close() }
            throw error
          }
          sessionInfo(accountId, initialSession)
        } finally {
          storeKey.fill(0)
        }
      }
    }

    AsyncFunction("stopSession") Coroutine { accountId: String ->
      requireSafeId(accountId, "account")
      sessionMutex.withLock {
        closeHandle(handles.remove(accountId), logout = false)
      }
    }

    AsyncFunction("logoutSession") Coroutine { accountId: String ->
      requireSafeId(accountId, "account")
      sessionMutex.withLock {
        val logoutResult = runCatching { closeHandle(handles.remove(accountId), logout = true) }
        val deletionResult = runCatching { deleteAccountStore(accountId) }
        logoutResult.getOrThrow()
        deletionResult.getOrThrow()
      }
    }

    AsyncFunction("listRoomIds") Coroutine { accountId: String ->
      requireSafeId(accountId, "account")
      val handle = requireHandle(accountId)
      handle.client.rooms().mapNotNull { room ->
        try {
          room.id().takeIf { safeRoomId.matches(it) }
        } finally {
          runCatching { room.close() }
        }
      }.distinct().take(512)
    }

    AsyncFunction("bindRoomKeyRecipients") Coroutine { accountId: String, roomId: String, peerId: String ->
      requireSafeId(accountId, "account")
      requireRoomId(roomId)
      requireMatrixUserId(peerId)
      requireHandle(accountId).client.encryption().use { encryption ->
        require(encryption.roomKeyRecipientPolicyVersion() == 1u) { "Matrix recipient policy is unavailable" }
        encryption.bindRoomKeyRecipients(roomId, peerId)
      }
    }

    AsyncFunction("openRoom") Coroutine { accountId: String, roomId: String ->
      requireSafeId(accountId, "account")
      requireRoomId(roomId)
      val session = requireHandle(accountId)
      session.rooms[roomId]?.let { existing -> return@Coroutine roomSnapshot(accountId, roomId, existing) }

      var room: Room? = null
      var timeline: Timeline? = null
      var listenerTask: TaskHandle? = null
      var installed: MatrixRoomHandle? = null
      try {
        room = session.client.getRoom(roomId) ?: session.client.joinRoomById(roomId)
        if (room.membership() == Membership.INVITED) room.join()
        require(room.membership() == Membership.JOINED) { "Matrix room membership is not joined" }
        require(room.isEncrypted()) { "Matrix room is not encrypted" }
        timeline = room.timeline()
        // timeline() initializes the queue inside the SDK's async runtime.
        // Calling the synchronous switch first tries to spawn its worker from
        // a Kotlin thread and panics before a fresh room can open.
        room.enableSendQueue(true)
        val items = mutableListOf<TimelineItem>()
        val created = MatrixRoomHandle(room, timeline, null, items)
        val raced = session.rooms.putIfAbsent(roomId, created)
        if (raced != null) {
          closeRoomHandle(created)
          return@Coroutine roomSnapshot(accountId, roomId, raced)
        }
        installed = created
        refreshRoomSubscriptions(session)
        created.hasMoreHistory = !timeline.paginateBackwards(100u)
        refreshTimelineListener(accountId, roomId, created)
        listenerTask = created.listenerTask
        roomSnapshot(accountId, roomId, created)
      } catch (error: Throwable) {
        installed?.let { session.rooms.remove(roomId, it) }
        runCatching { refreshRoomSubscriptions(session) }
        runCatching { listenerTask?.cancel() }
        runCatching { listenerTask?.close() }
        runCatching { timeline?.close() }
        runCatching { room?.close() }
        throw error
      }
    }

    AsyncFunction("paginateRoom") Coroutine { accountId: String, roomId: String, limit: Int ->
      requireSafeId(accountId, "account")
      requireRoomId(roomId)
      require(limit in 1..200) { "Invalid Matrix pagination limit" }
      val room = requireRoomHandle(accountId, roomId)
      room.paginationMutex.withLock {
        check(room.active) { "Matrix room is closed" }
        if (room.hasMoreHistory) {
          val reachedStart = room.timeline.paginateBackwards(limit.toUShort())
          synchronized(room.items) {
            check(room.active) { "Matrix room is closed" }
            room.hasMoreHistory = !reachedStart
          }
          refreshTimelineListener(accountId, roomId, room)
        }
        roomSnapshot(accountId, roomId, room)
      }
    }

    AsyncFunction("sendMessage") Coroutine { accountId: String, roomId: String, contentJson: String ->
      requireSafeId(accountId, "account")
      requireRoomId(roomId)
      val content = validateMessageContent(contentJson)
      val room = requireRoomHandle(accountId, roomId)
      val body = content.getString("body")
      val message = room.timeline.createMessageContent(MessageType.Other(VOLNA_MESSAGE_TYPE, body))
        ?: error("Matrix message content could not be created")
      val extra = JSONObject()
        .put("social.volna.content", content.getJSONObject("social.volna.content"))
        .put("social.volna.device_id", content.getString("social.volna.device_id"))
      val sendHandle = room.timeline.sendWithExtraContent(message, extra.toString())
      runCatching { sendHandle.close() }
      // Expo marshals the lambda's final value. kotlin.Result is not a bridge
      // value: returning it reports a failed send after SDK admission succeeded.
      Unit
    }

    AsyncFunction("closeRoom") Coroutine { accountId: String, roomId: String ->
      requireSafeId(accountId, "account")
      requireRoomId(roomId)
      handles[accountId]?.let { session ->
        closeRoomHandle(session.rooms.remove(roomId))
        refreshRoomSubscriptions(session)
      }
      Unit
    }

    AsyncFunction("setupRecovery") Coroutine { accountId: String ->
      requireSafeId(accountId, "account")
      val encryption = requireHandle(accountId).client.encryption()
      try {
        require(encryption.recoveryState() != RecoveryState.ENABLED) { "Matrix recovery is already enabled" }
        val recoveryKey = encryption.enableRecovery(true, null, VolnaRecoveryProgressListener)
        require(recoveryKey.length in 32..512) { "Matrix recovery key is invalid" }
        recoveryKey
      } finally {
        runCatching { encryption.close() }
      }
    }

    AsyncFunction("resetRecovery") Coroutine { accountId: String ->
      requireSafeId(accountId, "account")
      val encryption = requireHandle(accountId).client.encryption()
      try {
        require(encryption.verificationState() == org.matrix.rustcomponents.sdk.VerificationState.VERIFIED && encryption.recoveryState() == RecoveryState.ENABLED) { "Use a verified device with available recovery secrets" }
        val recoveryKey = encryption.resetRecoveryKey()
        require(recoveryKey.length in 32..512) { "Matrix recovery key is invalid" }
        recoveryKey
      } finally { runCatching { encryption.close() } }
    }

    AsyncFunction("recoverSecurity") Coroutine { accountId: String, recoveryKey: String ->
      requireSafeId(accountId, "account")
      require(recoveryKey.length in 32..512 && recoveryKey == recoveryKey.trim()) { "Invalid Matrix recovery key" }
      val encryption = requireHandle(accountId).client.encryption()
      try {
        encryption.recover(recoveryKey)
        encryption.waitForE2eeInitializationTasks()
        encryption.upgradeAuthenticatedBackup(true)
      } finally {
        runCatching { encryption.close() }
      }
    }

    AsyncFunction("getSecurityState") Coroutine { accountId: String, userIds: List<String> ->
      requireSafeId(accountId, "account")
      require(userIds.size in 1..4) { "Invalid Matrix identity query" }
      val handle = requireHandle(accountId)
      val encryption = handle.client.encryption()
      try {
        val identities = userIds.distinct().map { userId ->
          requireMatrixUserId(userId)
          require(matrixDomain(userId) == matrixDomain(handle.userId)) { "Matrix identity user domain mismatch" }
          val identity = encryption.userIdentity(userId, true)
          try {
            mapOf(
              "userId" to userId,
              "masterKey" to identity?.masterKey(),
              "verified" to (identity?.isVerified() == true),
              "changed" to (identity?.hasVerificationViolation() == true),
            )
          } finally {
            runCatching { identity?.close() }
          }
        }
        mapOf(
          "cryptoVersion" to "matrix-rust-sdk-ffi/26.08.13",
          "crossSigningReady" to (encryption.verificationState() == org.matrix.rustcomponents.sdk.VerificationState.VERIFIED),
          "secretStorageReady" to (encryption.recoveryState() == RecoveryState.ENABLED),
          "currentDevice" to mapOf(
            "userId" to handle.userId,
            "deviceId" to handle.deviceId,
            "ed25519" to encryption.ed25519Key(),
            "curve25519" to encryption.curve25519Key(),
          ),
          "identities" to identities,
          "pendingVerification" to synchronized(handle.verificationLock) { handle.verification?.let(::verificationSnapshot) },
        )
      } finally {
        runCatching { encryption.close() }
      }
    }

    AsyncFunction("startDeviceVerification") Coroutine { accountId: String, userId: String, deviceId: String ->
      requireSafeId(accountId, "account")
      requireMatrixUserId(userId)
      requireSafeId(deviceId, "device")
      val handle = requireHandle(accountId)
      handle.verificationMutex.withLock {
      check(handles[accountId] === handle) { "Matrix session changed" }
      require(matrixDomain(userId) == matrixDomain(handle.userId)) { "Matrix verification user domain mismatch" }
      val record = MatrixVerificationRecord(
        id = "mxverify_${UUID.randomUUID().toString().replace("-", "")}",
        initiatedByMe = true,
        otherUserId = userId,
        otherDeviceId = deviceId,
        flowId = null,
      )
      synchronized(handle.verificationLock) {
        require(handle.verification?.phase in listOf(null, "cancelled", "done")) { "A Matrix verification is already active" }
        handle.verification = record
        bindVerificationDelegate(accountId, handle, record)
      }
      try {
        handle.verificationController.requestSelectedDeviceVerification(userId, deviceId)
        check(handles[accountId] === handle && handle.verification === record) { "Matrix verification flow changed" }
        emitVerification(accountId, handle)
        verificationSnapshot(record)
      } catch (error: Throwable) {
        synchronized(handle.verificationLock) { if (handle.verification === record) handle.verification = null }
        throw error
      }
      }
    }

    AsyncFunction("acceptVerification") Coroutine { accountId: String, verificationId: String ->
      withVerification(accountId, verificationId) { handle, record ->
      require(!record.initiatedByMe && record.flowId != null) { "Matrix verification cannot be accepted" }
      handle.verificationController.acknowledgeVerificationRequest(record.otherUserId, record.flowId)
      handle.verificationController.acceptVerificationRequest()
      synchronized(handle.verificationLock) { if (record.phase == "requested") record.phase = "ready" }
      }
    }

    AsyncFunction("startSasVerification") Coroutine { accountId: String, verificationId: String ->
      withVerification(accountId, verificationId) { handle, record ->
      require(record.phase in listOf("requested", "ready")) { "Matrix SAS verification is not ready" }
      handle.verificationController.startSasVerification()
      synchronized(handle.verificationLock) { if (record.phase in listOf("requested", "ready")) record.phase = "started" }
      }
    }

    AsyncFunction("generateQrVerification") Coroutine { accountId: String, verificationId: String ->
      withVerification(accountId, verificationId) { handle, record ->
        require(record.phase == "ready") { "Matrix QR verification is not ready" }
        if (record.qrCodeBase64 != null) return@withVerification
        val bytes = handle.verificationController.generateQrVerification()
        try {
          synchronized(handle.verificationLock) {
            if (record.phase == "ready") record.qrCodeBase64 = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
          }
        } finally { bytes.fill(0) }
      }
    }

    AsyncFunction("scanQrVerification") Coroutine { accountId: String, verificationId: String, encoded: String ->
      require(encoded.length in 1..2731 && encoded.matches(Regex("^[A-Za-z0-9_-]+$"))) { "Invalid Matrix verification QR" }
      val bytes = Base64.decode(encoded, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
      try {
        require(bytes.size <= 2048 && Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) == encoded) { "Invalid Matrix verification QR" }
        withVerification(accountId, verificationId) { handle, record ->
          require(record.phase == "ready" && record.qrCodeBase64 == null) { "Matrix QR verification is not ready" }
          handle.verificationController.scanQrVerification(bytes)
          synchronized(handle.verificationLock) { if (record.phase == "ready") record.phase = "started" }
        }
      } finally { bytes.fill(0) }
    }

    AsyncFunction("confirmVerification") Coroutine { accountId: String, verificationId: String ->
      withVerification(accountId, verificationId) { handle, record ->
        require(record.phase == "started") { "Matrix verification is not ready" }
        if (record.qrNeedsConfirmation) handle.verificationController.approveQrVerification()
        else {
          require(record.sasEmoji.isNotEmpty() || record.sasDecimal != null) { "Matrix SAS data is not ready" }
          handle.verificationController.approveVerification()
        }
      }
    }

    AsyncFunction("mismatchVerification") Coroutine { accountId: String, verificationId: String ->
      withVerification(accountId, verificationId) { handle, record ->
        if (record.sasEmoji.isNotEmpty() || record.sasDecimal != null) handle.verificationController.declineVerification()
        else handle.verificationController.cancelVerification()
        synchronized(handle.verificationLock) { if (record.phase != "done") record.phase = "cancelled" }
      }
    }

    AsyncFunction("cancelVerification") Coroutine { accountId: String, verificationId: String ->
      withVerification(accountId, verificationId) { handle, record ->
        handle.verificationController.cancelVerification()
        synchronized(handle.verificationLock) { if (record.phase != "done") record.phase = "cancelled" }
      }
    }

    OnDestroy {
      handles.values.forEach { handle ->
        handle.rooms.values.forEach(::closeRoomHandle)
        handle.rooms.clear()
        runCatching { handle.syncService.close() }
        runCatching { handle.verificationController.close() }
        runCatching { handle.client.close() }
      }
      handles.clear()
    }
  }

  private suspend fun closeHandle(handle: MatrixSessionHandle?, logout: Boolean) {
    if (handle == null) return
    try {
      handle.rooms.values.forEach(::closeRoomHandle)
      handle.rooms.clear()
      handle.syncService.stop()
      if (logout) handle.client.logout()
    } finally {
      runCatching { handle.syncService.close() }
      runCatching { handle.verificationController.close() }
      runCatching { handle.client.close() }
    }
  }

  private fun requireHandle(accountId: String): MatrixSessionHandle =
    handles[accountId] ?: error("Matrix session is not running")

  private suspend fun refreshRoomSubscriptions(handle: MatrixSessionHandle) {
    // RoomListService replaces its subscription set. Serialize reads/submits so
    // opening or closing another room cannot overwrite a newer full set.
    handle.roomSubscriptionsMutex.withLock {
      handle.syncService.roomListService().use { service ->
        service.subscribeToRooms(handle.rooms.keys.toList())
      }
    }
  }

  private fun requireRoomHandle(accountId: String, roomId: String): MatrixRoomHandle =
    requireHandle(accountId).rooms[roomId] ?: error("Matrix room is not open")

  private fun requireVerification(accountId: String, verificationId: String): Pair<MatrixSessionHandle, MatrixVerificationRecord> {
    requireSafeId(accountId, "account")
    requireSafeId(verificationId, "verification")
    val handle = requireHandle(accountId)
    val record = synchronized(handle.verificationLock) { handle.verification }
      ?: error("Matrix verification request was not found")
    require(record.id == verificationId) { "Matrix verification request mismatch" }
    return handle to record
  }

  private suspend fun withVerification(accountId: String, id: String, action: suspend (MatrixSessionHandle, MatrixVerificationRecord) -> Unit): Map<String, Any?> {
    val (handle, expected) = requireVerification(accountId, id)
    return handle.verificationMutex.withLock {
      fun assertCurrent() {
        check(handles[accountId] === handle && handle.verification === expected) { "Matrix verification flow changed" }
      }
      assertCurrent()
      require(expected.phase !in listOf("done", "cancelled")) { "Matrix verification has ended" }
      action(handle, expected)
      assertCurrent()
      emitVerification(accountId, handle)
      synchronized(handle.verificationLock) { verificationSnapshot(expected) }
    }
  }

  private fun bindVerificationDelegate(accountId: String, handle: MatrixSessionHandle, record: MatrixVerificationRecord) {
    // The patched SDK snapshots this delegate for the admitted flow. Old flow
    // callbacks retain their old record and cannot relabel a newer request.
    val delegate = VolnaSessionVerificationDelegate { kind, payload ->
      applyVerificationUpdate(accountId, handle.generation, record, kind, payload)
    }
    handle.verificationDelegate = delegate
    handle.verificationController.setDelegate(delegate)
  }

  private fun applyVerificationUpdate(accountId: String, generation: String, expected: MatrixVerificationRecord?, kind: String, payload: Any?) {
    val handle = handles[accountId] ?: return
    if (handle.generation != generation) return
    synchronized(handle.verificationLock) {
      if (kind != "request" && (expected == null || handle.verification !== expected)) return
      if (kind != "request" && handle.verification?.phase in listOf("done", "cancelled")) return
      when (kind) {
        "request" -> {
          // A competing incoming flow never replaces the target currently
          // being compared by the user. Its SDK request can time out safely.
          if (handle.verification?.phase !in listOf(null, "cancelled", "done")) return
          val details = payload as? SessionVerificationRequestDetails ?: return
          val userId = details.senderProfile.userId
          if (
            !matrixUserIdPattern.matches(userId)
            || matrixDomain(userId) != matrixDomain(handle.userId)
            || !safeId.matches(details.deviceId)
            || details.flowId.isBlank()
            || details.flowId.length > 512
          ) return
          val incoming = MatrixVerificationRecord(
            id = "mxverify_${sha256("$userId\u0000${details.flowId}").take(40)}",
            initiatedByMe = false,
            otherUserId = userId,
            otherDeviceId = details.deviceId,
            flowId = details.flowId,
          )
          handle.verification = incoming
          bindVerificationDelegate(accountId, handle, incoming)
        }
        "accepted" -> if (handle.verification?.phase == "requested") handle.verification?.phase = "ready"
        "started" -> handle.verification?.let { it.phase = "started"; it.qrNeedsConfirmation = false; it.qrCodeBase64 = null }
        "data" -> {
          val record = handle.verification ?: return
          when (val data = payload as? SessionVerificationData ?: return) {
            is SessionVerificationData.Decimals -> {
              val values = data.values.map { it.toInt() }
              if (values.size == 3) record.sasDecimal = values
            }
            is SessionVerificationData.Emojis -> {
              val values = data.emojis.map { emoji ->
                try { listOf(emoji.symbol(), emoji.description()) } finally { runCatching { emoji.close() } }
              }
              if (values.size == 7) record.sasEmoji = values
            }
            SessionVerificationData.QrScanned -> record.qrNeedsConfirmation = true
            SessionVerificationData.QrWaiting -> record.qrNeedsConfirmation = false
          }
          record.phase = "started"
        }
        "done" -> handle.verification?.phase = "done"
        "cancelled", "failed" -> handle.verification?.phase = "cancelled"
      }
    }
    emitVerification(accountId, handle)
  }

  private fun emitVerification(accountId: String, handle: MatrixSessionHandle) {
    val value = synchronized(handle.verificationLock) { handle.verification?.let(::verificationSnapshot) } ?: return
    sendEvent(VERIFICATION_CHANGED_EVENT, mapOf("accountId" to accountId, "verification" to value))
  }

  private fun verificationSnapshot(record: MatrixVerificationRecord): Map<String, Any?> = mapOf(
    "id" to record.id,
    "phase" to record.phase,
    "initiatedByMe" to record.initiatedByMe,
    "otherUserId" to record.otherUserId,
    "otherDeviceId" to record.otherDeviceId,
    "sasDecimal" to record.sasDecimal,
    "sasEmoji" to record.sasEmoji,
    "qrCodeBase64" to record.qrCodeBase64.takeIf { record.phase in listOf("ready", "started") && record.sasEmoji.isEmpty() && record.sasDecimal == null },
    "qrSupported" to true,
    "qrNeedsConfirmation" to (record.phase == "started" && record.qrNeedsConfirmation),
  )

  private fun closeRoomHandle(handle: MatrixRoomHandle?) {
    if (handle == null) return
    synchronized(handle.items) {
      handle.active = false
      handle.listenerGeneration++
      handle.items.forEach { item -> runCatching { item.close() } }
      handle.items.clear()
    }
    runCatching { handle.listenerTask?.cancel() }
    runCatching { handle.listenerTask?.close() }
    runCatching { handle.timeline.close() }
    runCatching { handle.room.close() }
  }

  private fun applyTimelineDiff(items: MutableList<TimelineItem>, diff: List<TimelineDiff>) {
    diff.forEach { update ->
      when (update) {
        is TimelineDiff.Append -> items.addAll(update.values)
        is TimelineDiff.Clear -> {
          items.forEach { item -> runCatching { item.close() } }
          items.clear()
        }
        is TimelineDiff.PushFront -> items.add(0, update.value)
        is TimelineDiff.PushBack -> items.add(update.value)
        is TimelineDiff.PopFront -> if (items.isNotEmpty()) runCatching { items.removeAt(0).close() }
        is TimelineDiff.PopBack -> if (items.isNotEmpty()) runCatching { items.removeAt(items.lastIndex).close() }
        is TimelineDiff.Insert -> {
          val index = update.index.toInt()
          if (index in 0..items.size) items.add(index, update.value) else runCatching { update.value.close() }
        }
        is TimelineDiff.Set -> {
          val index = update.index.toInt()
          if (index in items.indices) runCatching { items.set(index, update.value).close() }
          else runCatching { update.value.close() }
        }
        is TimelineDiff.Remove -> {
          val index = update.index.toInt()
          if (index in items.indices) runCatching { items.removeAt(index).close() }
        }
        is TimelineDiff.Truncate -> {
          val length = update.length.toInt().coerceAtLeast(0)
          while (items.size > length) runCatching { items.removeAt(items.lastIndex).close() }
        }
        is TimelineDiff.Reset -> {
          items.forEach { item -> runCatching { item.close() } }
          items.clear()
          items.addAll(update.values)
        }
      }
    }
  }

  // addListener delivers an authoritative Reset synchronously before returning.
  // Re-subscribe after pagination to drain SDK diffs before resolving the page;
  // old callbacks are fenced, and indices always address the complete SDK vector.
  private suspend fun refreshTimelineListener(accountId: String, roomId: String, handle: MatrixRoomHandle) {
    val generation = synchronized(handle.items) {
      check(handle.active) { "Matrix room is closed" }
      ++handle.listenerGeneration
    }
    handle.listenerTask?.cancel()
    handle.listenerTask?.close()
    val task = handle.timeline.addListener(object : TimelineListener {
      override fun onUpdate(diff: List<TimelineDiff>) {
        val payload = synchronized(handle.items) {
          if (!handle.active || generation != handle.listenerGeneration) return
          applyTimelineDiff(handle.items, diff)
          handle.revision++
          roomSnapshot(accountId, roomId, handle)
        }
        sendEvent(ROOM_TIMELINE_EVENT, payload)
      }
    })
    synchronized(handle.items) {
      if (handle.active && generation == handle.listenerGeneration) handle.listenerTask = task
      else { task.cancel(); task.close() }
    }
  }

  private fun roomSnapshot(accountId: String, roomId: String, handle: MatrixRoomHandle): Map<String, Any> {
    return synchronized(handle.items) {
      check(handle.active) { "Matrix room is closed" }
      var unavailable = false
      val events = handle.items.mapNotNull { item -> timelineEvent(item) { unavailable = true } }
      mapOf("accountId" to accountId, "roomId" to roomId, "events" to events, "hasUndecryptableEvents" to unavailable,
        "timelineId" to handle.timelineId, "revision" to handle.revision, "hasMoreHistory" to handle.hasMoreHistory)
    }
  }

  private fun timelineEvent(item: TimelineItem, onUnavailable: () -> Unit): Map<String, Any>? {
    val event = item.asEvent() ?: return null
    return try {
      if (event.eventTypeRaw == "m.room.encrypted") { onUnavailable(); return null }
      if (event.eventTypeRaw != "m.room.message") return null
      val shield = event.lazyProvider.getShields(true)
      val authenticity = when (shield) {
        is ShieldState.Red -> shield.code
        is ShieldState.Grey -> shield.code
        ShieldState.None -> null
      }
      if (authenticity != null && authenticity != TimelineEventShieldStateCode.UNVERIFIED_IDENTITY) {
        // Legacy backup can decrypt without proving the original sender.
        // Preserve the refusal and expose the existing availability notice.
        onUnavailable()
        return null
      }
      val eventId = (event.eventOrTransactionId as? EventOrTransactionId.EventId)?.eventId ?: return null
      val raw = event.lazyProvider.debugInfo().originalJson ?: return null
      if (raw.toByteArray(Charsets.UTF_8).size > MAX_CONTENT_BYTES * 2) return null
      val parsed = JSONObject(raw)
      val content = parsed.optJSONObject("content") ?: return null
      // UniFFI exposes milliseconds as ULong; Expo only marshals JVM Number
      // values. Keep the JavaScript integer exact and avoid wrapping on cast.
      if (event.timestamp > 9_007_199_254_740_991uL) return null
      mapOf(
        "authenticated" to true,
        "eventId" to eventId,
        "senderUserId" to event.sender,
        "timestamp" to event.timestamp.toLong(),
        "contentJson" to content.toString(),
      )
    } catch (_: Throwable) {
      onUnavailable()
      null
    } finally {
      event.destroy()
    }
  }

  private fun validateMessageContent(value: String): JSONObject {
    require(value.toByteArray(Charsets.UTF_8).size in 1..MAX_CONTENT_BYTES) { "Invalid Matrix message size" }
    val content = JSONObject(value)
    require(content.length() == 4) { "Invalid Matrix message fields" }
    require(content.getString("msgtype") == VOLNA_MESSAGE_TYPE) { "Invalid Matrix message type" }
    val body = content.getString("body")
    require(body.isNotBlank() && body.length <= 1000) { "Invalid Matrix message body" }
    require(content.get("social.volna.content") is JSONObject) { "Invalid VOLNA message content" }
    require(safeId.matches(content.getString("social.volna.device_id"))) { "Invalid Matrix message device" }
    return content
  }

  private fun accountStoreRoot(accountId: String): File {
    val context = appContext.reactContext ?: error("Android application context is unavailable")
    val root = File(context.noBackupFilesDir, "volna-matrix").canonicalFile.apply { mkdirs() }
    val target = File(root, sha256(accountId)).canonicalFile
    check(target.parentFile == root) { "Unsafe Matrix store path" }
    return target.apply { mkdirs() }
  }

  private fun deleteAccountStore(accountId: String) {
    val target = accountStoreRoot(accountId)
    val root = target.parentFile?.canonicalFile ?: error("Matrix store root is unavailable")
    check(target.parentFile?.canonicalFile == root && root.name == "volna-matrix") { "Unsafe Matrix store deletion" }
    check(target.deleteRecursively() || !target.exists()) { "Unable to delete Matrix store" }
  }

  private fun sessionEvent(accountId: String, session: Session) = mapOf(
    "accountId" to accountId,
    "homeserverUrl" to session.homeserverUrl,
    "userId" to session.userId,
    "deviceId" to session.deviceId,
    "accessToken" to session.accessToken,
    "refreshToken" to session.refreshToken,
  )

  private fun sessionInfo(accountId: String, session: Session) = mapOf(
    "accountId" to accountId,
    "homeserverUrl" to session.homeserverUrl,
    "userId" to session.userId,
    "deviceId" to session.deviceId,
    "running" to true,
  )

  companion object {
    private val platformInitialized = AtomicBoolean(false)

    private fun ensurePlatformInitialized() {
      if (!platformInitialized.compareAndSet(false, true)) return
      try {
        initPlatform(
            TracingConfiguration(LogLevel.WARN, emptyList(), emptyList(), false, null),
          false,
        )
      } catch (error: Throwable) {
        platformInitialized.set(false)
        throw error
      }
    }

    private fun validateSessionInput(
      accountId: String,
      homeserverUrl: String,
      userId: String,
      deviceId: String,
      accessToken: String,
      refreshToken: String?,
    ) {
      requireSafeId(accountId, "account")
      requireSafeId(deviceId, "device")
      require(Regex("^@[a-z0-9._=/\\-]+:[a-z0-9.-]+(?::[0-9]+)?$").matches(userId)) { "Invalid Matrix user id" }
      require(accessToken.isNotEmpty() && accessToken.length <= 4096) { "Invalid Matrix access token" }
      require(refreshToken == null || (refreshToken.isNotEmpty() && refreshToken.length <= 4096)) { "Invalid Matrix refresh token" }
      normalizedHomeserverUrl(homeserverUrl)
    }

    private fun requireSafeId(value: String, label: String) {
      require(safeId.matches(value)) { "Invalid Matrix $label id" }
    }

    private fun requireRoomId(value: String) {
      require(safeRoomId.matches(value)) { "Invalid Matrix room id" }
    }

    private val matrixUserIdPattern = Regex("^@[a-z0-9._=/\\-]+:[a-z0-9.-]+(?::[0-9]+)?$")

    private fun requireMatrixUserId(value: String) {
      require(matrixUserIdPattern.matches(value)) { "Invalid Matrix user id" }
    }

    private fun matrixDomain(value: String): String = value.substringAfter(':', "")

    private fun normalizedHomeserverUrl(value: String): String {
      val uri = Uri.parse(value)
      val scheme = uri.scheme?.lowercase()
      val host = uri.host?.lowercase()
      require(uri.userInfo == null && host != null && (scheme == "https" || (scheme == "http" && host in setOf("localhost", "127.0.0.1")))) {
        "Matrix homeserver requires HTTPS"
      }
      return Uri.Builder()
        .scheme(scheme)
        .encodedAuthority(uri.encodedAuthority)
        .build()
        .toString()
    }

    private fun decodeStoreKey(value: String): ByteArray {
      require(Regex("^[A-Za-z0-9_-]{43}$").matches(value)) { "Invalid Matrix store key" }
      val decoded = Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
      require(decoded.size == 32) { "Matrix store key must contain 32 bytes" }
      return decoded
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
      .digest(value.toByteArray(Charsets.UTF_8))
      .joinToString("") { byte -> "%02x".format(byte) }
  }
}
