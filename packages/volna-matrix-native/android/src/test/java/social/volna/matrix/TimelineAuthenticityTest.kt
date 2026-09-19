package social.volna.matrix

import org.junit.Assert.*
import org.junit.Test
import org.matrix.rustcomponents.sdk.*
import uniffi.matrix_sdk_ui.TimelineEventShieldStateCode

/** The same bridge decision must hide unsafe content AND retain its notice. */
class TimelineAuthenticityTest {
  private class Provider(val shield: ShieldState, val fail: Boolean = false) : LazyTimelineItemProvider(NoHandle) {
    var disposed = false
    override fun getShields(strict: Boolean): ShieldState {
      assertTrue(strict)
      if (fail) error("fixture provider unavailable")
      return shield
    }
    override fun destroy() { disposed = true; super.destroy() }
  }

  private fun project(type: String, shield: ShieldState, fail: Boolean = false): Boolean {
    val provider = Provider(shield, fail)
    val item = object : TimelineItem(NoHandle) {
      override fun asEvent() = EventTimelineItem(
        true, EventOrTransactionId.TransactionId("fixture"), "@peer:test", ProfileDetails.Unavailable,
        null, null, false, false, TimelineItemContent.CallInvite, type, 1uL,
        null, null, emptyMap(), null, false, provider,
      )
    }
    var unavailable = false
    val method = VolnaMatrixNativeModule::class.java.getDeclaredMethod(
      "timelineEvent", TimelineItem::class.java, kotlin.jvm.functions.Function0::class.java,
    ).apply { isAccessible = true }
    assertNull(method.invoke(VolnaMatrixNativeModule(), item, { unavailable = true }))
    assertTrue(provider.disposed)
    item.close()
    return unavailable
  }

  @Test fun rejectedAuthenticityRemainsVisibleAsUnavailable() {
    for (code in TimelineEventShieldStateCode.values()) {
      for (shield in listOf(ShieldState.Red(code), ShieldState.Grey(code))) {
        assertEquals(code != TimelineEventShieldStateCode.UNVERIFIED_IDENTITY, project("m.room.message", shield))
      }
    }
    assertFalse(project("m.room.message", ShieldState.None))
  }

  @Test fun missingKeysAndProviderFailureDoNotBecomeAnEmptyHistory() {
    assertTrue(project("m.room.encrypted", ShieldState.None))
    assertTrue(project("m.room.message", ShieldState.None, fail = true))
    assertFalse(project("m.room.member", ShieldState.None))
  }
}
