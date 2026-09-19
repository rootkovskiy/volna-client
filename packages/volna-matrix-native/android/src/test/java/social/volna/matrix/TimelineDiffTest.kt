package social.volna.matrix

import org.junit.Assert.*
import org.junit.Test
import org.matrix.rustcomponents.sdk.NoHandle
import org.matrix.rustcomponents.sdk.TimelineDiff
import org.matrix.rustcomponents.sdk.TimelineItem

/** Exercise the real bridge reducer with the FFI's explicitly test-only objects. */
class TimelineDiffTest {
  private class Item(val number: Int) : TimelineItem(NoHandle) {
    var disposed = false
    override fun destroy() { disposed = true; super.destroy() }
  }

  private val module = VolnaMatrixNativeModule()
  private val apply = VolnaMatrixNativeModule::class.java.getDeclaredMethod(
    "applyTimelineDiff", MutableList::class.java, List::class.java,
  ).apply { isAccessible = true }

  private fun update(items: MutableList<TimelineItem>, vararg diff: TimelineDiff) {
    apply.invoke(module, items, diff.toList())
  }

  @Test fun fullSdkIndicesSurviveLargeHistoryAndPrepending() {
    val initial = (100..3299).map { Item(it) }
    val items = mutableListOf<TimelineItem>()
    update(items, TimelineDiff.Reset(initial))
    assertEquals(3200, items.size)
    for (index in 99 downTo 0) update(items, TimelineDiff.PushFront(Item(index)))
    assertEquals((0..3299).toList(), items.map { (it as Item).number })
    val replaced = items[3000] as Item
    update(items, TimelineDiff.Set(3000u, Item(9000)))
    assertTrue(replaced.disposed)
    assertEquals(9000, (items[3000] as Item).number)
    val removed = items[3] as Item
    update(items, TimelineDiff.Remove(3u), TimelineDiff.Insert(3u, Item(3)))
    assertTrue(removed.disposed)
    assertEquals(3, (items[3] as Item).number)
    assertEquals(3300, items.size)
  }

  @Test fun resetClearAndTruncateReleaseExactRetiredItems() {
    val old = (0..499).map { Item(it) }
    val items = mutableListOf<TimelineItem>()
    update(items, TimelineDiff.Append(old))
    update(items, TimelineDiff.Truncate(300u))
    assertTrue(old.drop(300).all { it.disposed })
    assertTrue(old.take(300).none { it.disposed })
    val fresh = listOf(Item(1000), Item(1001))
    update(items, TimelineDiff.Reset(fresh))
    assertTrue(old.all { it.disposed })
    update(items, TimelineDiff.PopFront, TimelineDiff.PopBack)
    assertTrue(fresh.all { it.disposed })
    assertTrue(items.isEmpty())
    val final = Item(2000)
    update(items, TimelineDiff.PushBack(final), TimelineDiff.Clear)
    assertTrue(final.disposed)
    assertTrue(items.isEmpty())
  }
}
