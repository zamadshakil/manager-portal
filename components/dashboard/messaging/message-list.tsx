"use client"

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react"
import { VariableSizeList } from "react-window"
import type { ListChildComponentProps } from "react-window"
import { ArrowDown, Loader2 } from "lucide-react"
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
    const prevMessageCount = useRef(messages.length)
    // Tracks whether the user is currently near the bottom of the list.
    // Written on every user-initiated scroll; read by isAtBottom() on the handle.
    const isAtBottomRef = useRef(true)

    const getItemSize = useCallback(
      (index: number) => {
        const msg = messages[index]
        if (!msg) return ESTIMATED_ITEM_SIZE
        return heightCache.current.get(msg.id) ?? ESTIMATED_ITEM_SIZE
      },
      [messages],
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
      if (messages.length === 0) return
      listRef.current?.scrollToItem(messages.length - 1, "end")
      // After react-window positions the last item using estimated heights,
      // force a native scroll so any measurement delta doesn't leave us short.
      requestAnimationFrame(() => {
        const outer = outerRef.current
        if (outer) outer.scrollTop = outer.scrollHeight
      })
    }, [messages.length])

    useImperativeHandle(ref, () => ({
      scrollToBottom,
      scrollToOffset: (offset: number) => {
        listRef.current?.scrollTo(offset)
      },
      getScrollOffset: () => outerRef.current?.scrollTop ?? 0,
      isAtBottom: () => isAtBottomRef.current,
    }))

    // On initial load + new messages: auto-scroll to bottom unless user scrolled up
    useEffect(() => {
      if (messages.length === 0) return
      const prevCount = prevMessageCount.current
      const isInitialLoad = prevCount === 0
      prevMessageCount.current = messages.length
      const outer = outerRef.current
      // Always scroll to bottom on first load or when DOM isn't ready yet.
      if (!outer || isInitialLoad) {
        scrollToBottom("auto")
        setShowScrollBadge(false)
        return
      }
      const distanceFromBottom = outer.scrollHeight - outer.scrollTop - outer.clientHeight
      const isNewMessage = messages.length > prevCount
      if (!isNewMessage || distanceFromBottom < 150) {
        scrollToBottom("auto")
        setShowScrollBadge(false)
      } else if (isNewMessage) {
        setShowScrollBadge(true)
      }
    }, [messages.length, scrollToBottom])

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
        const msg = messages[index]
        return (
          <div style={style}>
            <MeasuredRow
              message={msg}
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
      [messages, currentUserId, onReact, onEdit, onDelete, onReply, onRetry, setItemSize],
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
          itemCount={messages.length}
          getItemSize={getItemSize}
          Row={Row}
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
  message: Message
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
}

function SizedList({ listRef, outerRef, itemCount, getItemSize, Row, onScrolled }: SizedListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

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
  message,
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
      onMeasure(message.id, index, entry.contentRect.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [message.id, index, onMeasure])

  return (
    <div ref={rowRef}>
      <MessageRow
        message={message}
        isOwn={message.sender_id === currentUserId}
        currentUserId={currentUserId}
        onReact={onReact}
        onEdit={onEdit}
        onDelete={onDelete}
        onReply={onReply}
        onRetry={onRetry}
      />
    </div>
  )
}
