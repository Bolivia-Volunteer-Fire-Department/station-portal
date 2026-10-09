import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import ChatPanel from './ChatPanel';
import {
  deleteChatMessage,
  editChatMessage,
  fetchChatMessages,
  fetchChatPeople,
  fetchChatRooms,
  openChatThread,
  reactToChatMessage,
  sendChatMessage,
  setChatRead,
  updateChatParticipants,
} from '../../services/api';
import { subscribeChat, subscribeChatReceipts } from '../../services/liveReads';
import { clearTyping, publishTyping, startPresenceHeartbeat, subscribePresence, subscribeTyping } from '../../services/realtime';
import { typingActionFor, typingExpiresIn } from '../../utils/presence';
import { playSound } from '../../utils/uiSounds';
import { quietToast } from '../../utils/toast';
import { chatBadgeSound, chatMessageSound, chatNavigationSound, chatParticipantSound } from '../../utils/chatSounds';
import {
  CHAT_PAGE_SIZE,
  chatPermissionsFrom,
  mergeChatMessages,
  chatMillis,
  isChatThread,
  oldestChatCursor,
  sortChatRooms,
  totalUnread,
  unreadCountFor,
} from '../../utils/chat';

/**
 * CHAT, MOUNTED ONCE FOR THE WHOLE SESSION.
 *
 * This is the piece that makes chat "available from any module": it holds the two listeners, the room list and the open
 * conversation, and it draws either a floating panel over whatever the member is doing or - when the Chat tab is the
 * active one - the module itself. ONE instance, so switching to the Chat tab does not open a second set of listeners,
 * and a message that arrives while the member is on the schedule still lights the badge on the launcher.
 *
 * WITHOUT `can_use_chat` THIS RENDERS NOTHING AT ALL: not a disabled panel, not a launcher with no rooms - nothing. That
 * is what the permission means by "it is like the module does not exist", and the server agrees: the rules refuse the
 * reads, and the fan-out never writes such a member an inbox row to light in the first place.
 */
export default function ChatHost({ token, currentUser, role, timeFormat = '12', fullScreen = false, offline = false, ranks = [] }) {
  const flags = useMemo(() => chatPermissionsFrom(role), [role]);
  const userId = String(currentUser?.id || '');
  const roleId = String(currentUser?.role_id || '');
  const rankId = String(currentUser?.rank_id || '');

  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [inbox, setInbox] = useState({});
  const [activeRoomId, setActiveRoomId] = useState('');
  const [messages, setMessages] = useState([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');

  // The badge, from the rooms the member can actually see: an inbox row whose room has been deleted is invisible here
  // rather than counted forever. A badge that depends on a trigger having run is a badge that can be wrong.
  const unread = useMemo(() => totalUnread(rooms.map((room) => inbox[room.id])), [rooms, inbox]);
  // The inbox as it was last time this effect ran, so a badge GROWING can be told from a badge being read - and so which
  // room grew can be named in the tone and the toast.
  const lastInboxRef = useRef({});
  // Who was in the open conversation, and which conversation that was: a conversation seen for the first time is not
  // somebody joining it, so the first look only records the list.
  const membersRef = useRef({ id: '', ids: [] });

  // THE SOUNDS. One helper, so every call site reads the same way and a silent decision costs nothing: the six moments are
  // decided in utils/chatSounds.js and played here, through the app's own engine - which means a member who has turned the
  // app's sounds off hears none of them, which is right.
  const sound = useCallback((name) => {
    if (name) playSound(name);
  }, []);

  // The conversation the member was looking at, so a move can be told from an arrival; and whether the window for the room
  // now open has settled yet, so the first snapshot of thirty messages does not play thirty sounds.
  const lastRoomRef = useRef('');
  const windowSettledRef = useRef(false);

  // THE LISTENER'S VOLATILE INPUTS, IN A REF. Whether the panel is open, which room is muted and who the member is all
  // change while a conversation is open, and a socket torn down and re-attached every time a badge moves is a socket
  // churned for nothing - so the listener reads these at the moment a message arrives instead of subscribing to them.
  const contextRef = useRef({});
  contextRef.current = {
    open,
    fullScreen,
    muted: Boolean(inbox[activeRoomId]?.muted),
    viewerId: String(currentUser?.id || ''),
  };

  // EVERY WRITE TO THE MESSAGE LIST GOES THROUGH HERE, and it keeps a ref of the same list. The ref is what lets the
  // listener work out which messages are NEW before handing the merged list to React - the comparison cannot happen inside
  // a state updater, because React is allowed to call those twice and a sound played twice for one message is the sort of
  // bug nobody can reproduce.
  const messagesRef = useRef([]);
  const applyMessages = useCallback((next) => {
    messagesRef.current = typeof next === 'function' ? next(messagesRef.current) : next;
    setMessages(messagesRef.current);
  }, []);

  // WHO THIS MEMBER MAY MESSAGE, asked for when the picker is first opened rather than with the panel. It stays null until
  // then, so "not asked yet" and "asked, and there is nobody" remain different answers - a list that means both is how a
  // spinner gets mistaken for a result.
  const [people, setPeople] = useState(null);
  const [peopleLoading, setPeopleLoading] = useState(false);

  const loadPeople = useCallback(async () => {
    if (people !== null) return;
    setPeopleLoading(true);
    try {
      const data = await fetchChatPeople(token);
      setPeople(Array.isArray(data?.people) ? data.people : []);
    } catch (err) {
      setError(err.message || 'Could not load the members you can message.');
      setPeople([]);
    } finally {
      setPeopleLoading(false);
    }
  }, [people, token]);

  // PRESENCE AND TYPING, which live in Realtime Database rather than Firestore because both are facts that EXPIRE - see
  // services/realtime.js for why a timestamp beats an online flag, and utils/presence.js for what counts as one.
  //
  // THE CLOCK THE STALE DECISIONS NEED. Nothing in the database fires an event when a stamp stops being good, so the panel
  // has to be told when to look again. TWO timers rather than one, because the two facts age at very different speeds:
  // presence is slow enough that a dot lagging half a minute is invisible, while a typing line that outlives its sentence by
  // a few seconds reads as a broken app - and utils/presence.js#typingExpiresIn says exactly when the last stamp dies.
  const [presence, setPresence] = useState({});
  const [typing, setTyping] = useState({});
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const wait = typingExpiresIn({ typing, now: Date.now(), viewerId: userId });
    if (!wait) return;
    const timer = setTimeout(() => setNowMs(Date.now()), wait + 250);
    return () => clearTimeout(timer);
  }, [typing, userId]);

  // SAYING THIS MEMBER IS HERE, and stopping when they leave. One heartbeat per signed-in member, started while the module is
  // on and stopped by the function it returns - which also takes the node back out (see startPresenceHeartbeat).
  useEffect(() => {
    if (!flags.useChat || !userId) return;
    return startPresenceHeartbeat({ uid: userId });
  }, [flags.useChat, userId]);

  useEffect(() => {
    if (!flags.useChat) return;
    return subscribePresence({ onChange: setPresence });
  }, [flags.useChat]);

  // TYPING, FOR THE CONVERSATION THAT IS OPEN and no other: the tree is keyed by conversation, so an open chat costs one
  // THE RECEIPTS FOR THE OPEN CONVERSATION, which is what the ticks beside your own messages are drawn from: how far each other
  // member has read (functions/chat.js#chatReceiptsDoc). One document, woken only when somebody READS - which is the whole reason
  // the receipts live in a document of their own rather than on the conversation, whose preview fields change on every message.
  //
  // PRIVATE CONVERSATIONS ONLY, and that check is not a nicety: a station room has no receipts document at all, so watching one
  // would be a listener held on a document that cannot exist. `rooms` is a dependency because that is where the kind is known -
  // the room list is read when the panel opens, so this settles as soon as the conversation is.
  const [readAt, setReadAt] = useState({});
  useEffect(() => {
    setReadAt({});
    if (!flags.useChat || !activeRoomId) return undefined;
    const room = rooms.find((candidate) => candidate.id === activeRoomId);
    if (!isChatThread(room)) return undefined;
    return subscribeChatReceipts({
      conversationId: activeRoomId,
      onChange: (row) => setReadAt((row && row.read_at) || {}),
    });
  }, [flags.useChat, activeRoomId, rooms]);

  // TYPING, FOR THE CONVERSATION THAT IS OPEN and no other: the tree is keyed by conversation, so an open chat costs one
  // node's worth of updates rather than the whole station's.
  useEffect(() => {
    setTyping({});
    if (!flags.useChat || !activeRoomId) return;
    return subscribeTyping({ conversationId: activeRoomId, onChange: setTyping });
  }, [flags.useChat, activeRoomId]);

  // TELLING THE CONVERSATION THAT SOMEBODY IS TYPING. Called by the composer on every change of the draft and throttled by
  // the decision in utils/presence.js: a write per keystroke is the cost this exists to prevent, and a write to retract
  // something never announced is the other one. `typingRef` is what this client has already said.
  const typingRef = useRef(0);
  const signalTyping = useCallback(
    (draft) => {
      if (!flags.useChat || !activeRoomId || !userId) return;
      const action = typingActionFor({ draft, lastSentAt: typingRef.current });
      if (action === 'announce') {
        typingRef.current = Date.now();
        void publishTyping({ conversationId: activeRoomId, uid: userId });
      } else if (action === 'clear') {
        typingRef.current = 0;
        void clearTyping({ conversationId: activeRoomId, uid: userId });
      }
    },
    [flags.useChat, activeRoomId, userId]
  );

  const loadRooms = useCallback(async () => {
    if (!token || !flags.useChat) return;
    try {
      const data = await fetchChatRooms(token);
      setRooms(sortChatRooms(data?.chatRooms || []));
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load the rooms.');
    }
  }, [token, flags.useChat]);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  // THE TWO LISTENERS, attached for as long as the member is signed in - and the conversation one only while a room is
  // open, because a socket nobody is reading is a socket held open for nothing (see liveReads#subscribeChat).
  useEffect(() => {
    if (!token || !flags.useChat || !userId) return undefined;
    return subscribeChat({
      userId,
      roleId,
      rankId,
      conversationId: activeRoomId,
      handlers: {
        inbox: (rows) =>
          setInbox(Object.fromEntries(rows.map((row) => [String(row.conversation_id || row.id || ''), row]))),
        messages: (rows) => {
          // WHICH OF THESE ARE NEW, worked out against the list we already hold - see the note on messagesRef. The first
          // snapshot of a conversation is its whole window, up to thirty messages the member has not "just" received, so
          // nothing rings until the window has settled.
          const known = new Set(messagesRef.current.map((row) => String(row.id)));
          const arrived = windowSettledRef.current ? rows.filter((row) => !known.has(String(row.id))) : [];
          // ONLY SOMEBODY ELSE'S MESSAGE RINGS HERE. Your own message made its sound the moment the callable answered (see
          // `send`), and the listener echoing the same row back is the same message again - so it is filtered out rather
          // than left to play a second tone a moment later.
          const { viewerId, focused, muted } = {
            ...contextRef.current,
            focused: contextRef.current.open || contextRef.current.fullScreen,
          };
          const theirs = arrived.filter((row) => String(row.author_id) !== viewerId);
          // ONE TONE PER DELIVERY, however many messages landed together: two messages a second apart are one event to
          // hear, and the second tone would arrive over the first.
          if (theirs.length) sound(chatMessageSound({ mine: false, focused, muted }));
          windowSettledRef.current = true;
          applyMessages((current) => mergeChatMessages(current, rows));
        },
      },
      onError: (err) => setError(err?.message || 'Chat is having trouble staying connected.'),
    });
    // The dependencies are only what genuinely needs a NEW socket: the session and which conversation is open. Everything
    // else the handler needs it reads from contextRef (see above).
  }, [token, flags.useChat, userId, roleId, rankId, activeRoomId, sound, applyMessages]);

  // A MESSAGE ARRIVING WHILE THE MEMBER IS SOMEWHERE ELSE: the notification tone, and a QUIET toast.
  //
  // The badge is what tells us this happened - a conversation nobody has open is exactly the one whose messages are not in
  // hand - so this compares the inbox room by room rather than in total: which room grew is what decides whether the tone
  // should be heard and which name the toast carries. The toast is quiet because the tone has already played; the app's
  // own toast sound underneath it would be two noises for one message.
  useEffect(() => {
    const before = lastInboxRef.current;
    lastInboxRef.current = inbox;
    if (!rooms.length) return;
    for (const room of rooms) {
      const was = unreadCountFor(before[room.id]);
      const now = unreadCountFor(inbox[room.id]);
      if (now <= was) continue;
      const row = inbox[room.id] || {};
      const focused = (open || fullScreen) && room.id === activeRoomId;
      const tone = chatBadgeSound({
        unreadBefore: was,
        unreadAfter: now,
        focused,
        muted: row.muted === true,
        authorId: row.last_author_id,
        viewerId: userId,
      });
      if (!tone) continue;
      sound(tone);
      quietToast.info(`New message in ${room.name}`);
      break;
    }
  }, [inbox, rooms, open, fullScreen, activeRoomId, userId, sound]);

  // WHO IS IN THE CONVERSATION.
  //
  // `member_ids` is empty for a station room, whose audience is a role or a rank rather than a list of people - and names
  // the members of a private conversation, which is where these two tones come from. It is read from the room row rather
  // than from a listener of its own: the room list is already fetched when the panel opens, and a conversation whose
  // membership changes is one the station will want that row kept current anyway.
  //
  // A CONVERSATION SEEN FOR THE FIRST TIME IS NOT SOMEBODY JOINING IT, which is why the first look only records the list -
  // otherwise opening a two-person thread would play two entry tones.
  useEffect(() => {
    const row = rooms.find((room) => room.id === activeRoomId);
    if (!row) return;
    const ids = Array.isArray(row.member_ids) ? row.member_ids.map(String).filter(Boolean) : [];
    const before = membersRef.current;
    membersRef.current = { id: row.id, ids };
    if (before.id !== row.id) return;
    sound(chatParticipantSound({ previous: before.ids, next: ids }));
  }, [rooms, activeRoomId, sound]);

  // READING A ROOM MARKS IT READ: how far in the member has got, as one number on their own inbox row. Keyed on the
  // room's count, so it settles once per message rather than once per render.
  //
  // AND, FOR A PRIVATE CONVERSATION, HOW FAR IN TIME - which is what a receipt needs and a count cannot give. The other member's
  // screen compares that time against each message's own (utils/chat.js#deliveryStateFor), so it has to name a moment rather
  // than a number of messages. Only for a thread: a station room has no receipts document, and "seen by forty people" is not a
  // receipt anybody wants.
  //
  // The newest message IN THE WINDOW, which is what "read up to here" means for somebody looking at the conversation. A message
  // whose timestamp has not resolved yet sorts last and parses as zero, so `readAt` is left off and the next read mark carries
  // it - better a receipt a moment late than one stamped at the beginning of time.
  useEffect(() => {
    if (!activeRoomId || !token) return;
    const row = inbox[activeRoomId];
    const count = Number(row?.count) || 0;
    if (count <= (Number(row?.read_count) || 0)) return;
    const room = rooms.find((candidate) => candidate.id === activeRoomId);
    const newest = isChatThread(room) ? chatMillis(messagesRef.current[messagesRef.current.length - 1]?.created_at) : 0;
    setChatRead({ conversationId: activeRoomId, readCount: count, readAt: newest || undefined }, token).catch(() => {});
  }, [activeRoomId, inbox, token, rooms]);

  // OPENING AND CLOSING A CONVERSATION. The sound is decided from the move rather than from each entry point, so a room
  // switch, the panel's back button and the module all make the same noise for the same act. The window flag is cleared
  // with it: the next snapshot is a fresh window, not thirty new messages.
  const openRoom = useCallback(
    (id) => {
      const next = String(id || '');
      sound(chatNavigationSound({ from: lastRoomRef.current, to: next }));
      lastRoomRef.current = next;
      windowSettledRef.current = false;
      applyMessages([]);
      setActiveRoomId(next);
    },
    [sound, applyMessages]
  );

  const closeRoom = useCallback(() => {
    sound(chatNavigationSound({ from: lastRoomRef.current, to: '' }));
    lastRoomRef.current = '';
    windowSettledRef.current = false;
    applyMessages([]);
    setActiveRoomId('');
  }, [sound, applyMessages]);

  // ADDING, REMOVING, AND LEAVING, which is one operation with three names: leaving is removing yourself. One function rather
  // than three, so the rules about who may change a conversation live in one place on the server (functions/chat.js) and the
  // screen only has to say which change it wants.
  //
  // IT SITS HERE, AFTER loadRooms AND closeRoom, AND THAT IS NOT A PREFERENCE. A useCallback's dependency array is evaluated
  // when the callback is CREATED, not when it runs - so a callback that lists something declared below it throws
  // "Cannot access 'loadRooms' before initialization" on the very first render, taking the whole chat host down with it. This
  // is the second time in this file that the order mattered; see startThread below for the same rule.
  //
  // THE ROOM LIST IS RE-READ AFTERWARDS, and that is what makes the entry and exit tones work: they are decided by this
  // conversation's member list changing (utils/chatSounds.js#chatParticipantSound, in the participants effect above), so a
  // membership change that is not followed by a refresh is a change nobody hears.
  const changeParticipants = useCallback(
    async ({ conversationId, add = [], remove = [] }) => {
      const result = await updateChatParticipants({ conversationId, add, remove }, token);
      await loadRooms();
      return result;
    },
    [token, loadRooms]
  );

  const leaveThread = useCallback(
    async (conversationId) => {
      const result = await changeParticipants({ conversationId, remove: [userId] });
      // A member who has left the conversation is looking at a screen they are no longer part of, so the panel is sent back to
      // the list. The server refuses the last removal (a conversation needs two people), which leaves the throw for the caller.
      closeRoom();
      return result;
    },
    [changeParticipants, userId, closeRoom]
  );

  // STARTING A PRIVATE CONVERSATION, AND OPENING IT. The callable answers with the conversation either way: the one it has
  // just made, or the one that already exists between these people - the id is derived from the members, so there is only
  // ever one (functions/chat.js#chatThreadIdFor). The room list is refreshed first, so the conversation the member is about
  // to be looking at is in the list behind it, and then it is opened - which is also what plays the opening sound and
  // clears the message window, because it goes through the same door every other conversation does.
  const startThread = useCallback(
    async (memberIds) => {
      const result = await openChatThread({ memberIds }, token);
      const id = String(result?.id || result?.conversation?.id || '');
      if (!id) throw new Error('That conversation could not be started.');
      await loadRooms();
      openRoom(id);
      return id;
    },
    [token, loadRooms, openRoom]
  );

  const loadOlder = useCallback(async () => {
    if (!token || !activeRoomId || loadingOlder) return;
    const before = oldestChatCursor(messages);
    if (!before) return;
    setLoadingOlder(true);
    try {
      const data = await fetchChatMessages({ conversationId: activeRoomId, before }, token);
      applyMessages((current) => mergeChatMessages(current, data?.messages || []));
    } catch (err) {
      setError(err.message || 'Could not load older messages.');
    } finally {
      setLoadingOlder(false);
    }
  }, [token, activeRoomId, loadingOlder, messages]);

  // SENDING, EDITING AND REMOVING all answer with the message they wrote, so the sender's own screen draws it at once.
  // The listener echoes each of them a moment later and the merge replaces by id, which is why this is an optimisation
  // rather than a second source of truth.
  const send = useCallback(
    async (body, gif) => {
      const result = await sendChatMessage({ conversationId: activeRoomId, body, gif }, token);
      // YOUR OWN MESSAGE MAKES ITS SOUND HERE, at the moment it lands, rather than when the listener echoes it back - which
      // is both sooner and exactly once (the listener filters your own rows out for that reason). A muted room is silent,
      // which chatMessageSound decides along with everything else.
      sound(chatMessageSound({ mine: true, focused: true, muted: contextRef.current.muted }));
      if (result?.message) applyMessages((current) => mergeChatMessages(current, [result.message]));
    },
    [activeRoomId, token, sound, applyMessages]
  );

  const edit = useCallback(
    async (messageId, body) => {
      const result = await editChatMessage({ conversationId: activeRoomId, messageId, body }, token);
      if (result?.message) applyMessages((current) => mergeChatMessages(current, [result.message]));
    },
    [activeRoomId, token]
  );

  const remove = useCallback(
    async (message) => {
      const result = await deleteChatMessage({ conversationId: activeRoomId, messageId: message.id }, token);
      if (result?.message) applyMessages((current) => mergeChatMessages(current, [result.message]));
    },
    [activeRoomId, token]
  );

  // A TAP ON A REACTION, which is a TOGGLE on the server: the callable adds the member to one emoji or takes them out of it, and
  // this merges the row it returns exactly as sending and editing do - so the member sees their own tap land at once, and the
  // listener's echo replaces that row by id rather than doubling it.
  //
  // NOTHING HERE IS OPTIMISTIC, which is the same decision the message itself makes: the server owns that map (the messages
  // collection refuses every client write), so a tap that invented its own state would have to be rolled back the moment it was
  // refused - and a reaction vanishing a second after it appeared is worse than one that arrives a second late.
  const react = useCallback(
    async (message, emoji) => {
      if (!activeRoomId || !message?.id) return;
      try {
        const result = await reactToChatMessage({ conversationId: activeRoomId, messageId: message.id, emoji }, token);
        // A REFUSAL RESOLVES, IT DOES NOT THROW - and that was the bug that made reactions look broken.
        //
        // `routeWrite` answers a refused callable with `{ success: false, message: '...' }` rather than rejecting, and this
        // code used to check only for a `message`. So the server's explanation - "A removed message cannot be reacted to", or
        // "That is not one of the reactions" - was passed to `mergeChatMessages` as though it were a message ROW. Nothing
        // appeared on screen and nothing said why: the failure was not hidden from the member so much as thrown away.
        // `success` is the field that tells the two apart, and it has to be checked before the message is used.
        //
        // SENDING AND EDITING HAVE THE SAME SHAPE AND THE SAME HOLE, which is why this is written out rather than folded into
        // one helper - but a fix belongs there too, and it is called out in the notes for whoever gets there next.
        if (!result?.success) throw new Error(result?.message || 'That reaction could not be saved.');
        if (result.message) applyMessages((current) => mergeChatMessages(current, [result.message]));
      } catch (err) {
        // "internal [0]" IS WHAT AN UNREACHABLE CALLABLE LOOKS LIKE, and it is not a sentence anybody can act on. A function
        // that is not deployed, a browser with no connection and a blocked request all arrive this way - as a code with a
        // number beside it - so the useful half of the message is added rather than replaced: a member knows what to try, and
        // whoever is debugging still has the original text in front of them.
        const raw = String(err?.message || '');
        const unreachable = /internal|failed to fetch|networkerror|cors/i.test(raw);
        setError(
          unreachable
            ? `That did not reach the server, so nothing was saved (${raw || 'no response'}). Check your connection and try again.`
            : raw || 'That reaction could not be saved.'
        );
      }
    },
    [activeRoomId, token, applyMessages]
  );

  const toggleMute = useCallback(
    async (conversationId, muted) => {
      await setChatRead({ conversationId, muted }, token);
      // The listener is what normally brings this back; the optimistic row is what makes the switch feel like a switch.
      setInbox((current) => ({
        ...current,
        [conversationId]: { ...(current[conversationId] || {}), muted },
      }));
    },
    [token]
  );

  if (!flags.useChat) return null;

  const panel = (
    <ChatPanel
      fullScreen={fullScreen}
      rooms={rooms}
      inbox={inbox}
      activeRoomId={activeRoomId}
      onOpenRoom={openRoom}
      onCloseRoom={closeRoom}
      onClose={fullScreen ? undefined : () => setOpen(false)}
      messages={messages}
      loading={loadingOlder}
      hasOlder={messages.length >= CHAT_PAGE_SIZE}
      onLoadOlder={loadOlder}
      flags={flags}
      currentUser={currentUser}
      offline={offline}
      timeFormat={timeFormat}
      onSend={send}
      ranks={ranks}
      onEdit={edit}
      onDelete={remove}
      onReact={react}
      onToggleMute={toggleMute}
      people={people || []}
      peopleLoading={peopleLoading}
      onLoadPeople={loadPeople}
      onStartThread={startThread}
      presence={presence}
      typing={typing}
      nowMs={nowMs}
      readAt={readAt}
      onTyping={signalTyping}
      onChangeParticipants={changeParticipants}
      onLeaveThread={leaveThread}
      error={error}
    />
  );

  // THE MODULE IS THE SAME PANEL, at full width: one implementation of a chat, two frames.
  if (fullScreen) return panel;

  return (
    <>
      {open && panel}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? 'Close chat' : 'Open chat'}
        className="fixed bottom-4 right-4 z-[54] flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white shadow-xl transition hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
      >
        {open ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
        {!open && unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-800">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </>
  );
}

