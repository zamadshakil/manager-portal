"use client"

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react"
import { VariableSizeList } from "react-window"
import type { ListChildComponentProps } from "react-window"
import { ArrowDown, Loader2 } from "lucide-react"
import { format, isToday, isYesterday } from "date-fns"
import { Button } from "@/components/ui/button"
import { MessageRow } from "./message-row"
import type { Message } from "@/lib/types"

export interface MessageListHandle {
  scrollToBottom: (behavior?: ScrollBehavior) => void
  /** Scroll the virtual list to an absolute pixel offset. */
  scrollToOffset: (offset: number) => void
  /** Return the current scroll offset (scrollTop of the outer container). */
  getScrollOffset: () => number
  /** True when the user is within 100 px of the bottom of the list. */
  isAtBottom: () => boolean
}

interface MessageListProps {
  messages: Message[]
  currentUserId: string
  loadingMore: boolean
  hasMore: boolean
  onLoadMore: () => void
  onReact: (msgId: string, emoji: string) => void
  onEdit: (msg: Message, newContent: string) => void
  onDelete: (msgId: string) => void
  onReply: (msg: Message) => void
  onRetry: (msg: Message) => void
  /** Called (on user-initiated scroll) when the list reaches near the bottom. */
  onScrolledToBottom?: () => void
}

export const ESTIMATED_ITEM_SIZE = 72
const SEPARATOR_HEIGHT = 36

// ── List item union ──────────────────────────────────────────────────────────

type MessageListItem = {
  kind: "message"
  id: string
  message: Message
  isFirstInGroup: boolean
  isLastInGroup: boolean
}

type SeparatorListItem = {
  kind: "separator"
  id: string
  label: string
}

type ListItem = MessageListItem | SeparatorListItem

function formatDayLabel(iso: string): string {
  const d = new Date(iso)
  if (isToday(d)) return "Today"
  if (isYesterday(d)) return "Yesterday"
  return format(d, "MMMM d, yyyy")
}

function computeListItems(messages: Message[]): ListItem[] {
  const items: ListItem[] = []
  let lastDayKey = ""

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const prev = messages[i - 1]
    const next = messages[i + 1]
    const dayKey = format(new Date(msg.created_at), "yyyy-MM-dd")

    // Insert day separator whenever the date changes
    if (dayKey !== lastDayKey) {
      lastDayKey = dayKey
      items.push({ kind: "separator", id: `sep-${dayKey}`, label: formatDayLabel(msg.created_at) })
    }

    // Grouping: same sender, same day, within 5 min, neither deleted
    const sameSenderAsPrev =
      !!prev && prev.sender_id === msg.sender_id && !prev.deleted_at && !msg.deleted_at
    const closeToPrev =
      sameSenderAsPrev &&
      new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000
    const sameDayAsPrev = !!prev && format(new Date(prev.created_at), "yyyy-MM-dd") === dayKey
    const isFirstInGroup = !(closeToPrev && sameDayAsPrev)

    const sameSenderAsNext =
      !!next && next.sender_id === msg.sender_id && !next.deleted_at && !msg.deleted_at
    const closeToNext =
      sameSenderAsNext &&
      new Date(next.created_at).getTime() - new Date(msg.created_at).getTime() < 5 * 60 * 1000
    const sameDayAsNext = !!next && format(new Date(next.created_at), "yyyy-MM-dd") === dayKey
    const isLastInGroup = !(closeToNext && sameDayAsNext)

    items.push({ kind: "message", id: msg.id, message: msg, isFirstInGroup, isLastInGroup })
  }

  return items
}

// ── MessageList ──────────────────────────────────────────────────────────────

export const MessageList = forwardRef<MessageListHandle, MessageListProps>(
  function MessageList(
    { messages, currentUserId, loadingMore, hasMore, onLoadMore, onReact, onEdit, onDelete, onReply, onRetry, onScrolledToBottom },
    ref,
  ) {
    const listRef = useRef<VariableSizeList>(null)
    const heightCache = useRef<Map<string, number>>(new Map())
    const outerRef = useRef<HTMLDivElement>(null)
    const [showScrollBadge, setShowScrollBadge] = useState(false)
    const sentinelRef = useRef<HTMLDivElement>(null)
    const prevListItemCountRef = useRef(0)
    const pendingInitialScrollRef = useRef(false)
    // Tracks whether the user is currently near the bottom of the list.
    // Written on every user-initiated scroll; read by isAtBottom() on the handle.
    const isAtBottomRef = useRef(true)

    const listItems = useMemo(() => computeListItems(messages), [messages])
    // Stable ref so scrollToBottom can read current length without being a dep
    const listItemsRef = useRef(listItems)
    listItemsRef.current = listItems

    const getItemSize = useCallback(
      (index: number) => {
        const item = listItems[index]
        if (!item) return ESTIMATED_ITEM_SIZE
        if (item.kind === "separator") return SEPARATOR_HEIGHT
        return heightCache.current.get(item.id) ?? ESTIMATED_ITEM_SIZE
      },
      [listItems],
    )

    const setItemSize = useCallback(
      (id: string, index: number, height: number) => {
        if (heightCache.current.get(id) === height) return
        heightCache.current.set(id, height)
        listRef.current?.resetAfterIndex(index, false)
      },
      [],
    )

    const scrollToBottom = useCallback((_behavior: ScrollBehavior = "smooth") => {
      const items = listItemsRef.current
      if (items.length === 0) return
      listRef.current?.scrollToItem(items.length - 1, "end")
      // After react-window positions the last item using estimated heights,
      // force a native scroll so any measurement delta doesn't leave us short.
      requestAnimationFrame(() => {
        const outer = outerRef.current
        if (outer) outer.scrollTop = outer.scrollHeight
      })
    }, []) // stable — reads from ref

    useImperativeHandle(ref, () => ({
      scrollToBottom,
      scrollToOffset: (offset: number) => {
        listRef.current?.scrollTo(offset)
      },
      getScrollOffset: () => outerRef.current?.scrollTop ?? 0,
      isAtBottom: () => isAtBottomRef.current,
    }))

    // On initial load + new items: auto-scroll to bottom unless user scrolled up
    useEffect(() => {
      if (listItems.length === 0) return
      const prevCount = prevListItemCountRef.current
      const isInitialLoad = prevCount === 0
      prevListItemCountRef.current = listItems.length
      const outer = outerRef.current
      if (isInitialLoad) {
        if (!outer) {
          // SizedList hasn't measured yet — scroll once it reports ready
          pendingInitialScrollRef.current = true
        } else {
          scrollToBottom("auto")
        }
        setShowScrollBadge(false)
        return
      }
      if (!outer) return
      const distanceFromBottom = outer.scrollHeight - outer.scrollTop - outer.clientHeight
      const isNewItems = listItems.length > prevCount
      if (!isNewItems || distanceFromBottom < 150) {
        scrollToBottom("auto")
        setShowScrollBadge(false)
      } else if (isNewItems) {
        setShowScrollBadge(true)
      }
    }, [listItems.length, scrollToBottom])

    // Called by SizedList once it has a measured height — execute any deferred initial scroll
    const handleListReady = useCallback(() => {
      if (pendingInitialScrollRef.current) {
        pendingInitialScrollRef.current = false
        requestAnimationFrame(() => scrollToBottom("auto"))
      }
    }, [scrollToBottom])

    // Infinite scroll sentinel
    useEffect(() => {
      if (!hasMore) return
      const sentinel = sentinelRef.current
      if (!sentinel) return
      const observer = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting && !loadingMore) onLoadMore() },
        { threshold: 0.1 },
      )
      observer.observe(sentinel)
      return () => observer.disconnect()
    }, [hasMore, loadingMore, onLoadMore])

    const Row = useCallback(
      ({ index, style }: ListChildComponentProps) => {
        const item = listItems[index]
        if (!item) return null

        if (item.kind === "separator") {
          return (
            <div style={style} className="flex items-center gap-3 px-6 select-none" aria-hidden="true">
              <div className="flex-1 h-px bg-border/50" />
              <time
                dateTime={item.id.replace("sep-", "")}
                className="text-[11px] font-medium text-muted-foreground/55 shrink-0 bg-background px-1"
              >
                {item.label}
              </time>
              <div className="flex-1 h-px bg-border/50" />
            </div>
          )
        }

        return (
          <div style={style}>
            <MeasuredRow
              item={item}
              index={index}
              currentUserId={currentUserId}
              onReact={onReact}
              onEdit={onEdit}
              onDelete={onDelete}
              onReply={onReply}
              onRetry={onRetry}
              onMeasure={setItemSize}
            />
          </div>
        )
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [listItems, currentUserId, onReact, onEdit, onDelete, onReply, onRetry, setItemSize],
    )

    return (
      <div className="relative flex-1 min-h-0">
        {/* Load-more sentinel at the top */}
        <div ref={sentinelRef} className="absolute top-0 left-0 w-full h-1 pointer-events-none" />
        {loadingMore && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 text-xs text-muted-foreground bg-background/90 px-3 py-1 rounded-full shadow border">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        )}

        <SizedList
          listRef={listRef}
          outerRef={outerRef}
          itemCount={listItems.length}
          getItemSize={getItemSize}
          Row={Row}
          onReady={handleListReady}
          onScrolled={({ scrollOffset, scrollUpdateWasRequested }) => {
            if (scrollUpdateWasRequested) return
            const outer = outerRef.current
            if (!outer) return
            const distanceFromBottom = outer.scrollHeight - scrollOffset - outer.clientHeight
            isAtBottomRef.current = distanceFromBottom < 100
            if (distanceFromBottom < 50) {
              setShowScrollBadge(false)
              // Notify parent so it can mark the conversation as read when
              // the user scrolls down to the latest message.
              onScrolledToBottom?.()
            }
          }}
        />

        {/* New-message scroll badge */}
        {showScrollBadge && (
          <div className="absolute bottom-4 right-4">
            <Button
              size="sm"
              className="rounded-full shadow-lg gap-1.5"
              onClick={() => { scrollToBottom(); setShowScrollBadge(false) }}
            >
              <ArrowDown className="h-3.5 w-3.5" /> New message
            </Button>
          </div>
        )}
      </div>
    )
  },
)

interface MeasuredRowProps {
  item: MessageListItem
  index: number
  currentUserId: string
  onReact: (msgId: string, emoji: string) => void
  onEdit: (msg: Message, newContent: string) => void
  onDelete: (msgId: string) => void
  onReply: (msg: Message) => void
  onRetry: (msg: Message) => void
  onMeasure: (id: string, index: number, height: number) => void
}

// ── SizedList: fills parent via ResizeObserver, no AutoSizer needed ────────
interface SizedListProps {
  listRef: React.RefObject<VariableSizeList | null>
  outerRef: React.RefObject<HTMLDivElement | null>
  itemCount: number
  getItemSize: (index: number) => number
  Row: React.ComponentType<ListChildComponentProps>
  onScrolled: (info: { scrollOffset: number; scrollUpdateWasRequested: boolean }) => void
  onReady?: () => void
}

function SizedList({ listRef, outerRef, itemCount, getItemSize, Row, onScrolled, onReady }: SizedListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const onReadyFiredRef = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    ro.observe(el)
    // initial size
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Fire onReady once after the list first has a measured height
  useEffect(() => {
    if (size.height > 0 && !onReadyFiredRef.current) {
      onReadyFiredRef.current = true
      onReady?.()
    }
  }, [size.height, onReady])

  return (
    <div ref={containerRef} className="absolute inset-0">
      {size.height > 0 && (
        <VariableSizeList
          ref={listRef}
          outerRef={outerRef as React.Ref<HTMLDivElement>}
          height={size.height}
          width={size.width}
          itemCount={itemCount}
          itemSize={getItemSize}
          estimatedItemSize={ESTIMATED_ITEM_SIZE}
          onScroll={onScrolled}
        >
          {Row}
        </VariableSizeList>
      )}
    </div>
  )
}

function MeasuredRow({
  item,
  index,
  currentUserId,
  onReact,
  onEdit,
  onDelete,
  onReply,
  onRetry,
  onMeasure,
}: MeasuredRowProps) {
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      onMeasure(item.id, index, entry.contentRect.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [item.id, index, onMeasure])

  return (
    <div ref={rowRef}>
      <MessageRow
        message={item.message}
        isOwn={item.message.sender_id === currentUserId}
        currentUserId={currentUserId}
        isFirstInGroup={item.isFirstInGroup}
        isLastInGroup={item.isLastInGroup}
        onReact={onReact}
        onEdit={onEdit}
        onDelete={onDelete}
        onReply={onReply}
        onRetry={onRetry}
      />
    </div>
  )
}
