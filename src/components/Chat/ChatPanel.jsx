import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckCheck, Clock, Film, Loader2, LogOut, Pencil, Plus, Search, Send, Smile, Trash2, Users, Volume2, VolumeX, X } from 'lucide-react';
import EmojiPicker from './EmojiPicker';
import GifPicker from './GifPicker';
import { CHAT_REACTION_EMOJI } from '../../utils/chatEmoji';
import RankIcon from '../RankIcon';
import { formatStationTime } from '../../utils/timeFormat';
import { unnamedLabel } from '../../utils/displayLabel';
import { gifAspectRatio } from '../../utils/chatGifs';
import {
  CHAT_THREAD_MEMBERS_MAX,
  canDeleteChatMessage,
  canEditChatMessage,
  chatDeletedNotice,
  chatMessageRow,
  chatMillis,
  chatSendProblem,
  chatThreadTitle,
  deliveryStateFor,
  hasUnread,
  isChatThread,
  normalizeChatBody,
  unreadCountFor,
} from '../../utils/chat';
import { isPresent, onlineCountOf, typingIdsIn, typingLabelFor } from '../../utils/presence';

// One message, as a bubble. Its own component so the panel's markup stays readable, and so the three states a message can
// be in - sent, edited, removed - are decided in one place rather than three times in the thread below.
function ChatBubble({ message, mine, flags, currentUser, timeFormat, delivery, ranks = [], onEdit, onDelete, onReact }) {
  const row = chatMessageRow(message);
  const notice = chatDeletedNotice(row);
  // THE AUTHOR'S RANK ICON, from the rank the row NAMES rather than from an icon stored on the message: a station that repaints
  // "Officer" repaints it here too, and a message with no rank (or a rank with no icon) draws nothing at all - which is why the
  // name is only rendered when there is one, rather than handing RankIcon an empty string and getting its fallback glyph on
  // every message written before this existed.
  const authorRank = ranks.find((rank) => String(rank?.id || '') === String(row.author_rank_id || '')) || null;
  const authorRankIcon = String((authorRank && authorRank.icon) || '');
  // WHAT PEOPLE MADE OF IT. The map travels WITH the message (see functions/chat.js), so drawing these costs no read at all - and
  // because a tap is a toggle, the emoji the member is already behind is drawn differently: pressing it again takes them out.
  //
  // `mineReacted` is why the viewer's id is needed here rather than only the count: "3 people reacted" and "you and 2 others
  // reacted" are the same pill to look at and different things to press, since one of them undoes something.
  const viewerId = String(currentUser?.id || '');
  // Whether this bubble's own reaction picker is open. Per MESSAGE rather than per panel, because that is what it is about -
  // and the picker closes on the first choice: one tap is one reaction, and a picker that stayed open would look like it was
  // collecting them.
  const [showReactions, setShowReactions] = useState(false);
  // WHETHER THE PICTURE FAILED TO LOAD. A GIF is often the WHOLE message, so an `<img>` that quietly disappears - or worse,
  // leaves a broken-image glyph - would turn a joke into an empty bubble with a name under it. Saying so is the only honest
  // rendering of "there was a picture here and your browser could not fetch it", and it needs no state for the case where
  // it worked, which is nearly always.
  const [gifFailed, setGifFailed] = useState(false);
  const reactions = row.reactions && typeof row.reactions === 'object' ? row.reactions : {};
  const reactionRows = Object.entries(reactions)
    .map(([emoji, list]) => {
      const members = Array.isArray(list) ? list.map(String) : [];
      return [emoji, members.length, members.includes(viewerId)];
    })
    .filter(([, count]) => count > 0);
  const editable = canEditChatMessage({ flags, message: row, viewerId: currentUser?.id });
  const removable = canDeleteChatMessage({ flags, message: row, viewerId: currentUser?.id });
  const when = row.created_ms ? new Date(row.created_ms) : null;

  return (
    <li className={`group flex ${mine ? 'justify-end' : 'items-end gap-2'}`}>
      {/* THE FACE BESIDE THE BUBBLE, which is where a conversation is read from: a person is identified by their picture
          before the words under the bubble are read at all, and putting it here means the eye finds it without hunting
          through the metadata line's 10px text.

          ALIGNED TO THE BOTTOM, not the top, BECAUSE THE NAME IS BELOW THE BUBBLE in this panel - so the face ends up
          level with the name it belongs to rather than with the first line of a paragraph. WhatsApp's timestamp sits
          inside the bubble and Telegram's name sits above it; neither matches this layout, and the pairing that matters
          here is face-and-name.

          A SPACER RATHER THAN NOTHING WHEN THERE IS NO PICTURE. The gutter has to be the same whether or not somebody
          has set a photo, or every bubble in the station shifts sideways depending on who is talking - and in a fire
          station most members will never set one, so the ragged version is the common case rather than the edge case.
          `aria-hidden` because it is a gap, and a screen reader should not hear about a gap. */}
      {!mine &&
        (row.author_avatar_url ? (
          <img
            src={row.author_avatar_url}
            alt=""
            aria-hidden="true"
            loading="lazy"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
            className="h-8 w-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="h-8 w-8 shrink-0" aria-hidden="true" />
        ))}
      {/* The bubble, its reactions and its metadata, in a column of their own so the face can sit beside all three.
          THE WIDTH LIMIT LIVES HERE rather than on the bubble, because 85% of the ROW is still what bounds a message -
          measuring against this column instead would leave the bubble's own 85% meaning 72% of the row, which is a
          narrower conversation than this panel had before for no reason anybody chose. */}
      <div className={`flex min-w-0 max-w-[85%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
        <div
          className={`max-w-full rounded-2xl px-3 py-2 text-sm ${
          row.deleted
            ? 'border border-dashed border-slate-300 bg-transparent text-slate-500 italic dark:border-slate-600 dark:text-slate-400'
            : mine
              ? 'bg-red-600 text-white'
              : 'bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-slate-100'
        }`}
      >
        {notice ? (
          <span>{notice}</span>
        ) : (
          <>
            {/* THE PICTURE, ABOVE THE WORDS, because the picture is usually what the message IS and the words - when there
                are any - are a caption under it.

                THE SPACE IS RESERVED BEFORE IT LOADS, which is the whole reason the width and height are stored on the row:
                the box is the right shape from the first frame, so the conversation above it does not move as each picture
                arrives. A chat that jumps while you are reading it is a chat you stop reading.

                WHY THE RATIO IS AN INLINE STYLE AND NOT A CLASS: Tailwind cannot write an arbitrary ratio that comes out of
                the database, and the alternative - a fixed height for every picture - letterboxes a tall clip and squashes a
                wide one. `object-contain` then fits whatever actually arrives inside the box the row promised.

                `<picture>` WITH WEBP FIRST AND THE GIF AS THE `src`, which is the right way round: the `<source>` is the
                PREFERRED file and the `<img>` is what a browser without it falls back to. That matters because older iOS
                cannot animate a webp, and the row carries both URLs for exactly this - a message that draws nothing is worse
                than one that costs more bytes. */}
            {row.gif_url && (
              <div className="mb-2">
                {gifFailed ? (
                  <p className="rounded-xl bg-black/5 px-3 py-2 text-xs italic dark:bg-white/10">
                    This picture did not load.
                  </p>
                ) : (
                  <picture>
                    <source srcSet={row.gif_url} type="image/webp" />
                    <img
                      src={row.gif_fallback_url || row.gif_url}
                      alt={row.gif_alt || 'Picture'}
                      width={row.gif_width || undefined}
                      height={row.gif_height || undefined}
                      loading="lazy"
                      decoding="async"
                      onError={() => setGifFailed(true)}
                      style={{ aspectRatio: gifAspectRatio({ width: row.gif_width, height: row.gif_height }) }}
                      className="max-h-72 w-full rounded-xl object-contain"
                    />
                  </picture>
                )}
              </div>
            )}
            <span className="whitespace-pre-wrap break-words">{row.body}</span>
          </>
        )}
      </div>

      {/* WHAT PEOPLE MADE OF IT, under the bubble and above the metadata line: the count, and whether the member reading is one
          of them. A pill is a TOGGLE - pressing one you are already in takes you out - so the one that is yours is drawn
          differently, and `aria-pressed` says which that is without relying on colour. */}
      {reactionRows.length > 0 && (
        <ul className="mt-1 flex flex-wrap items-center gap-1 px-1">
          {reactionRows.map(([emoji, count, mineReacted]) => (
            <li key={emoji}>
              <button
                type="button"
                onClick={() => onReact?.(row, emoji)}
                aria-pressed={mineReacted}
                aria-label={`${emoji} ${count} reaction${count === 1 ? '' : 's'}${mineReacted ? ', yours included' : ''}`}
                title={mineReacted ? 'You reacted - press to take it back' : 'Add your reaction'}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition ${
                  mineReacted
                    ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                }`}
              >
                <span aria-hidden="true">{emoji}</span>
                <span>{count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* THE METADATA LINE, HUGGING THE BUBBLE IT BELONGS TO: who and what-changed, then the tick, then WHEN.
          It is content-sized rather than full width, which is what keeps it under the right side of the conversation: the list
          item beside it is already aligned by the author (`items-end` for your own, `items-start` for theirs), so a row that
          stretched across the panel would strand the controls at one edge and the time at the other - a gap with a message in
          the middle of it, which is exactly what this looked like before.
          The ORDER still matters, and the edit and delete controls still come first: they are reserved space that stays
          invisible until hover, so anything after them shifts sideways the moment they appear. The tick and the time are the
          last things on the line, and nothing sits to their right to move them. */}
      <div className="mt-0.5 flex items-center gap-2 px-1 text-[10px] text-slate-500 dark:text-slate-400">
        {!mine && (
          <span className="flex items-center gap-1 font-semibold">
            {/* The rank's own icon, before the name, and only on somebody else's message: your own name is not drawn beside your
                own bubble, so a badge for the person reading would be decoration.
                THE FACE IS NOT HERE ANY MORE - it sits beside the bubble, at the left of the row above this line. It was a
                20px circle in this 10px text, which is small enough that a picture of a person's face read as a smudge. */}
            {authorRankIcon && <RankIcon name={authorRankIcon} className="h-3 w-3 shrink-0" />}
            {row.author_name || unnamedLabel('member')}
          </span>
        )}
        {row.edited_ms > 0 && <span className="italic">edited</span>}
        {/* THE SMILEY, IN A POSITIONED BOX OF ITS OWN - AND THAT BOX IS THE BUG FIX.
            Its popover is `absolute`, which measures from the nearest POSITIONED ancestor and not from the button it hangs
            under. The metadata line is a plain flex row, so there was no such ancestor anywhere up the tree until the page
            itself: `bottom-full` therefore meant "just above the top of the document", and the picker opened off-screen.
            The button worked, the click worked, and nothing appeared - which is exactly what "reacting to my own message does
            nothing" looked like. `relative` on this span is the whole of the fix; the `align` side then decides which way the
            picker grows, so your own message (on the right) grows leftward and somebody else's grows rightward.

            AND IT IS NOT OFFERED ON A REMOVED MESSAGE, because the server refuses that ("A removed message cannot be reacted
            to") - a control that cannot work is worse than one that is not there, which is the same rule the picture picker
            follows about file types. The refusal is now shown rather than swallowed, but the tap should not be offered at all. */}
        {onReact && !notice && (
          <span className="relative flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => setShowReactions((open) => !open)}
              aria-expanded={showReactions}
              aria-label="React to this message"
              title="React to this message"
              className="rounded p-0.5 opacity-0 transition hover:bg-slate-200 group-hover:opacity-100 group-focus-within:opacity-100 dark:hover:bg-slate-600"
            >
              <Smile className="h-3 w-3" />
            </button>
            {showReactions && (
              <EmojiPicker
                align={mine ? 'right' : 'left'}
                // `only` IS THE FIX FOR "picking an emoji does nothing": the server accepts a fixed set of reactions, and
                // without this the picker drew the composer's whole list - so a tap on anything else came back as "That is not
                // one of the reactions." and looked like nothing happening at all.
                only={CHAT_REACTION_EMOJI}
                onPick={(emoji) => {
                  setShowReactions(false);
                  onReact?.(row, emoji);
                }}
                onClose={() => setShowReactions(false)}
              />
            )}
          </span>
        )}
        {(editable || removable) && (
          // The controls appear on hover, and are always REACHABLE by keyboard: hover-only would make editing impossible
          // without a mouse, and this panel is used on phones.
          //
          // THE BIN COMES BEFORE THE PENCIL, and the line as a whole reads right to left: the time, the tick, the pencil, the
          // bin. That is the order it was asked for, and it is the order that puts the two things about the MESSAGE at the
          // far end (when it was sent and whether it arrived) with the two things about CHANGING it behind them.
          <span className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
            {removable && (
              <button
                type="button"
                onClick={() => onDelete(row)}
                className="rounded p-0.5 hover:bg-slate-200 dark:hover:bg-slate-600"
                aria-label="Remove this message"
                title="Remove this message"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
            {editable && (
              <button
                type="button"
                onClick={() => onEdit(row)}
                className="rounded p-0.5 hover:bg-slate-200 dark:hover:bg-slate-600"
                aria-label="Edit this message"
                title="Edit this message"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </span>
        )}
        {/* WHAT MY OWN MESSAGE HAS DONE, between the controls and the time, which is where it was asked to sit: SENDING (a clock -
            the server has not confirmed it yet), SENT (one tick), SEEN (two, in green). Drawn only on your own messages and only
            where a receipt means something, which is why `delivery` is empty for anybody else's and for a station room.
            `role="img"` with a label because a tick is information, not decoration - a screen reader should hear "seen". */}
        {delivery === 'sending' && (
          <span className="shrink-0 text-slate-400" role="img" aria-label="Sending" title="Sending">
            <Clock className="h-3 w-3" />
          </span>
        )}
        {delivery === 'sent' && (
          <span className="shrink-0 text-slate-400" role="img" aria-label="Sent" title="Sent">
            <Check className="h-3 w-3" />
          </span>
        )}
        {delivery === 'seen' && (
          <span className="shrink-0 text-emerald-500" role="img" aria-label="Seen" title="Seen">
            <CheckCheck className="h-3 w-3" />
          </span>
        )}
        {/* AND A WAY TO ADD ONE, which has MOVED: it used to sit between the tick and the time, which pushed the receipt
            apart from the timestamp it belongs beside. It now sits left of the controls, so the line still reads the way it
            was asked to - from the right: the time, the tick, the pencil, the bin. See the block above the controls. */}
        {when && <span className="shrink-0">{formatStationTime(when, timeFormat, false)}</span>}
      </div>
      </div>
    </li>
  );
}

// One room in the list: its name, the last thing said, and what is waiting.
//
// `title` comes in rather than being read off the room, because a PRIVATE CONVERSATION HAS NO NAME OF ITS OWN: it is called
// whatever its members are called from where the member reading it is standing (utils/chat.js#chatThreadTitle). A row that
// read `room.name` would draw every thread as a blank line.
function ChatRoomRow({ room, inboxRow, active, onOpen, timeFormat, title }) {
  const unread = unreadCountFor(inboxRow);
  const preview = room.last_preview
    ? `${room.last_author_name ? `${room.last_author_name}: ` : ''}${room.last_preview}`
    : room.last_at
      ? 'Message removed'
      : 'No messages yet';
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(room.id)}
        className={`w-full rounded-xl px-3 py-2 text-left transition ${
          active ? 'bg-red-50 dark:bg-red-950/40' : 'hover:bg-slate-100 dark:hover:bg-slate-700'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
          {unread > 0 && (
            <span className="ml-auto shrink-0 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {unread}
            </span>
          )}
          {inboxRow?.muted && unread === 0 && <VolumeX className="ml-auto h-3 w-3 shrink-0 text-slate-400" />}
        </div>
        <div className="flex items-center gap-2">
          <span className={`truncate text-xs ${hasUnread(inboxRow) ? 'font-semibold text-slate-700 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400'}`}>
            {preview}
          </span>
          {room.last_at && (
            <span className="ml-auto shrink-0 text-[10px] text-slate-400">
              {formatStationTime(new Date(chatMillis(room.last_at)), timeFormat, false)}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

// THE PICKER: choosing who a private conversation is between.
//
// WHO IS IN THIS LIST IS NOT THE PANEL'S DECISION. The people come from the server (the `getChatPeople` callable), which
// offers exactly those whose role grants Chat - not one of them more, not one less - because that is a question about other
// members' ROLES and a member cannot read those. The panel draws what it was handed. A screen that filtered for permission
// itself would be a second opinion, and the two would drift: the day they disagreed, the list would either offer somebody
// the server refuses, or hide somebody it would have accepted.
//
// ONE MEMBER OR SEVERAL: the same list does both, because a private conversation is stored as a list of members rather than
// as a pair (functions/chat.js#chatThreadDoc). Picking two people and picking one are the same act with a different number
// on it, and the cap is the server's own (CHAT_THREAD_MEMBERS_MAX, counting the member picking).
export function ChatPeoplePicker({ people, loading, picked, filter, error, starting, presence, now, submitLabel, currentMembers, onFilter, onToggle, onStart, onRemove, onAddPeople, onBack }) {
  const others = Math.max(1, CHAT_THREAD_MEMBERS_MAX - 1);
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return people;
    return people.filter((person) => String(person.name || '').toLowerCase().includes(needle));
  }, [people, filter]);

  // THE MEMBERS VIEW: who is in this conversation, and a remove button each.
  //
  // THE SAME COMPONENT, because it is the same people - the list you choose from when adding and the list you remove from are
  // two halves of one question ("who is in this conversation"), and a second screen for the second half would be two places to
  // keep in step. `currentMembers` is what tells them apart, and it must be an ARRAY rather than a flag: the view needs the
  // people, not just the fact that it is looking at them.
  //
  // NOBODY REMOVES THEMSELVES HERE. Leaving is its own button in the conversation's header, with wording that says what it
  // means, and the server refuses the removal that would leave one person in a conversation - so an X beside your own name
  // would be a button the server declines. The caller leaves you out of the list for that reason.
  //
  // IT STAYS OPEN WHEN THE SERVER REFUSES, which is why the error shows here rather than in the conversation: "a private
  // conversation needs two people" is an answer to a press the member has just made, and closing the list would take the
  // sentence away with it.
  if (currentMembers) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-slate-200 px-2 py-1.5 dark:border-slate-700">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {currentMembers.length === 1 ? '1 other member' : `${currentMembers.length} other members`}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          <ul className="space-y-0.5">
            {currentMembers.map((person) => (
              <li key={person.id} className="flex items-center gap-2 rounded-xl px-3 py-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    isPresent({ at: presence[person.id] && presence[person.id].at, now })
                      ? 'bg-emerald-500'
                      : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                  aria-hidden="true"
                />
                <span className="truncate text-sm text-slate-900 dark:text-white">
                  {person.name || unnamedLabel('member')}
                </span>
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(person.id)}
                    className="ml-auto shrink-0 rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                    aria-label={`Remove ${person.name || 'this member'} from this conversation`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {error && <p className="mt-1 px-3 text-xs text-amber-700 dark:text-amber-300">{error}</p>}
        </div>

        <div className="border-t border-slate-200 px-2 py-2 dark:border-slate-700">
          <button
            type="button"
            onClick={onAddPeople}
            className="mx-auto flex w-full max-w-sm items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-red-400 hover:text-red-700 dark:border-slate-600 dark:text-slate-300 dark:hover:border-red-500 dark:hover:text-red-300"
          >
            <Plus className="h-4 w-4" /> Add people
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-2 py-1.5 dark:border-slate-700">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          <ArrowLeft className="h-4 w-4" /> Rooms
        </button>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {picked.length ? `${picked.length} selected` : 'Choose who to talk to'}
        </span>
      </div>

      <div className="border-b border-slate-200 px-2 py-1.5 dark:border-slate-700">
        <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-2 py-1 dark:bg-slate-700">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <input
            type="search"
            value={filter}
            onChange={(event) => onFilter(event.target.value)}
            placeholder="Find a member"
            aria-label="Find a member"
            className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading ? (
          <p className="flex items-center justify-center gap-2 p-4 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading members…
          </p>
        ) : people.length === 0 ? (
          // NOBODY TO PICK FROM IS A REAL ANSWER, and it needs saying: it means no other role in the station grants Chat, not
          // that something failed. A member reading an empty list with no explanation would report it as a bug.
          <p className="p-3 text-sm text-slate-500 dark:text-slate-400">
            Nobody else can use chat yet. An officer grants it on a role, in Administration → Roles.
          </p>
        ) : shown.length === 0 ? (
          <p className="p-3 text-sm text-slate-500 dark:text-slate-400">No member matches “{filter}”.</p>
        ) : (
          <ul className="space-y-0.5">
            {shown.map((person) => {
              const on = picked.includes(person.id);
              // At the cap, the rows that are not already chosen stop being offered rather than being offered and then
              // refused on the way out - and the ones already chosen stay switchable off, so the last press is never a
              // dead end.
              const full = !on && picked.length >= others;
              return (
                <li key={person.id}>
                  <label
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 ${
                      full ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={full}
                      onChange={() => onToggle(person.id)}
                      className="h-4 w-4 shrink-0 accent-red-600"
                    />
                    {/* WHO IS HERE, in the list you choose from: the difference between messaging somebody who will answer
                        and messaging somebody who is asleep, which is the one thing this list cannot tell you any other way. */}
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        isPresent({ at: presence[person.id] && presence[person.id].at, now }) ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="truncate text-sm text-slate-900 dark:text-white">
                      {person.name || unnamedLabel('member')}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-slate-200 px-2 py-2 dark:border-slate-700">
        {error && <p className="mb-1.5 text-xs text-amber-700 dark:text-amber-300">{error}</p>}
        <button
          type="button"
          onClick={onStart}
          disabled={!picked.length || starting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {submitLabel || (picked.length > 1 ? 'Start conversation' : 'Message')}
        </button>
        <p className="mt-1 text-center text-[10px] text-slate-400">
          {submitLabel
            ? `Up to ${others} ${others === 1 ? 'member' : 'members'} in one conversation.`
            : `A conversation nobody else can see, up to ${others} ${others === 1 ? 'member' : 'members'}.`}
        </p>
      </div>
    </div>
  );
}

/**
 * THE CHAT PANEL: the room list, the conversation that is open, and the box you type in.
 *
 * ONE COMPONENT, TWO SIZES. Docked at the right of the window on a desktop it is a panel a member can keep open WHILE
 * WORKING IN ANOTHER MODULE - which is the whole reason chat is not just another tab. On a phone it is a full-height
 * sheet, and the Chat module renders this same component full-screen, so there is one implementation of a chat and not
 * two: `fullScreen` changes the frame and nothing else.
 *
 * The data it is handed comes from ChatHost - the subscription, the room list, the open conversation's window - and what
 * lives here is the draft, the message being edited, and whether the emoji picker is showing.
 */
export default function ChatPanel({
  fullScreen = false,
  rooms = [],
  inbox = {},
  activeRoomId = '',
  onOpenRoom,
  onClose,
  onCloseRoom,
  messages = [],
  loading = false,
  hasOlder = false,
  onLoadOlder,
  flags = {},
  currentUser,
  // Whether this device has a network. It reaches the composer as a disabled send button and a sentence rather than as a
  // failure after the press - see utils/chat.js#chatSendProblem for why a message is refused rather than queued.
  offline = false,
  timeFormat = '12',
  onSend,
  // THE RANKS, for the icon drawn before an author's name. Plumbed from App like every other screen's, because chat is not handed
  // the roster: the message carries the `rank_id` and this array is what turns it into a glyph (components/RankIcon).
  ranks = [],
  onEdit,
  onDelete,
  // A TAP ON AN EMOJI, passed straight down to each bubble: the panel does not decide anything about reactions, it hands the
  // message and the emoji to the host, which owns the callable.
  onReact,
  onToggleMute,
  // THE PICKER'S THREE. `people` is who this member may message, from the server; `onLoadPeople` asks for them the first
  // time the picker is opened; `onStartThread` opens (or finds) the conversation and returns once it is open. The panel
  // keeps no directory of its own - see the note on ChatPeoplePicker for why that is not its decision to make.
  people = [],
  peopleLoading = false,
  onLoadPeople,
  onStartThread,
  // PRESENCE AND TYPING, from the host (see services/realtime.js). All three arrive together because they are one question -
  // "who is here, and what are they doing" - asked against one reading of the clock, which is why `nowMs` is passed rather
  // than read per row: two rows drawing from two different `Date.now()`s can disagree about the same stamp.
  presence = {},
  typing = {},
  nowMs = 0,
  // HOW FAR THE OTHER MEMBERS HAVE READ, in one private conversation: the map on its receipts document, which the host watches
  // (services/liveReads#subscribeChatReceipts). Empty for a station room, where there is nothing to watch.
  readAt = {},
  onTyping,
  // ADDING AND REMOVING PEOPLE. `onChangeParticipants` is the server's one operation (add, remove, or both) and
  // `onLeaveThread` is the same thing said about yourself. Both are the host's, because both need the session token and the
  // room list refresh that follows them - see ChatHost#changeParticipants.
  onChangeParticipants,
  onLeaveThread,
  error = '',
}) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  // THE PICTURE WAITING TO BE SENT, held here rather than sent the moment it is picked - so that a caption can be typed
  // under it, and so that somebody who taps the wrong tile can see what they are about to send and take it back. Picking is
  // the point where a station chat most needs an undo, because a GIF is loud.
  const [showGifs, setShowGifs] = useState(false);
  const [pendingGif, setPendingGif] = useState(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);
  const activeRoom = useMemo(() => rooms.find((room) => room.id === activeRoomId) || null, [rooms, activeRoomId]);
  const mine = String(currentUser?.id || '');
  const problem = chatSendProblem({ body: draft, offline, hasGif: Boolean(pendingGif) });

  // WHAT A CONVERSATION IS CALLED FROM HERE. A room carries its name; a private conversation is titled with the OTHER
  // members - "Ana" to Ben, "Ben" to Ana - which is why the server stores no name for one (functions/chat.js#chatThreadDoc).
  const labelFor = useCallback((room) => chatThreadTitle({ room, viewerId: mine }), [mine]);

  // THE PICKER. `picking` swaps the room list for the people list, and the people themselves are fetched when it opens
  // rather than with the panel: most visits to chat are to read a room, and reading the directory to answer a question
  // nobody asked is the kind of cost that adds up across a station.
  // whether the emoji picker is showing. `pickingFor` says WHICH of the two things the picker is doing - starting a private
  // conversation from the room list, or adding people to the one that is open - because they are the same list and the same
  // selection, and only the button at the bottom and the call it makes differ.
  const [picking, setPicking] = useState(false);
  const [pickingFor, setPickingFor] = useState('new');

  // WHO IS HERE, AND WHO IS TYPING. Worked out once per render from the presence and typing maps the host passes down,
  // against the ONE clock reading - the helpers are pure (utils/presence.js), so this is arithmetic rather than a
  // subscription per row.
  const now = nowMs || Date.now();
  const activeMembers = Array.isArray(activeRoom?.member_ids) ? activeRoom.member_ids.map(String) : [];
  const activeOnline = onlineCountOf({ ids: activeMembers, presence, now });
  const typingIds = typingIdsIn({ typing, now, viewerId: mine });
  const typingLabel = useMemo(() => {
    if (!typingIds.length) return '';
    // NAMES WHERE THERE ARE ANY. A private conversation carries its members' names (functions/chat.js#chatThreadDoc), so a
    // typing line there can say who. A station room's audience is a role rather than a list of people, so there are no names
    // to reach for without another read - and "Somebody is typing…" is a better trade than a directory read per keystroke.
    const names = typingIds.map((id) => {
      const at = activeMembers.indexOf(id);
      return at >= 0 ? String(activeRoom?.member_names?.[at] || '') : '';
    });
    return names.every(Boolean) ? typingLabelFor({ names }) : typingLabelFor({ names: ['Somebody'] });
  }, [typingIds, activeMembers, activeRoom]);

  // TELL THE CONVERSATION WHEN THE DRAFT CHANGES, which is what the host turns into a throttled typing stamp - and what takes
  // it back when the box empties, including after a send (which clears the draft like anything else).
  useEffect(() => {
    onTyping?.(draft);
  }, [draft, onTyping]);
  const [picked, setPicked] = useState([]);
  const [filter, setFilter] = useState('');
  const [starting, setStarting] = useState(false);
  const [pickerError, setPickerError] = useState('');

  useEffect(() => {
    if (picking) onLoadPeople?.();
  }, [picking, onLoadPeople]);

  const togglePicked = useCallback((id) => {
    setPickerError('');
    setPicked((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }, []);

  // REMOVING SOMEBODY ELSE, which is the same server operation as adding and as leaving. The picker STAYS OPEN on purpose: the
  // refusals here are answers a member can act on - "a private conversation needs two people" is the one they will actually
  // see - and closing the list would take the sentence away with it.
  const removeMember = useCallback(
    async (id) => {
      if (!activeRoomId) return;
      setPickerError('');
      try {
        await onChangeParticipants?.({ conversationId: activeRoomId, remove: [id] });
      } catch (err) {
        setPickerError(err?.message || 'That member could not be removed.');
      }
    },
    [activeRoomId, onChangeParticipants]
  );

  // WHO ELSE IS IN THIS CONVERSATION, with their names, for the members list. Built from what the conversation row already
  // carries (`member_ids` and the names beside them - see functions/chat.js#chatThreadDoc), so opening the list costs no read
  // at all, and the member looking at it is left out because leaving is the header's business.
  const otherMembers = useMemo(
    () =>
      activeMembers
        .map((id, at) => ({ id, name: String(activeRoom?.member_names?.[at] || '') }))
        .filter((person) => person.id !== mine),
    [activeMembers, activeRoom, mine]
  );

  const startThread = useCallback(async () => {
    if (!picked.length || starting) return;
    setStarting(true);
    setPickerError('');
    try {
      // ONE PICKER, TWO CALLS. Adding to an open conversation and starting a new one differ only here - and the label at the
      // bottom of the picker says which is about to happen, so the same list is never ambiguous.
      if (pickingFor === 'add' && activeRoomId) {
        await onChangeParticipants?.({ conversationId: activeRoomId, add: picked });
      } else {
        await onStartThread?.(picked);
      }
      setPicking(false);
      setPicked([]);
      setFilter('');
    } catch (err) {
      // The server's own words, where there are any: it refuses for reasons the member can act on ("Ben cannot use chat", or
      // "A private conversation needs two people" when they try to leave the last one), and replacing those with something
      // went-wrong would throw away the only useful half of the answer.
      setPickerError(err?.message || 'That conversation could not be changed.');
    } finally {
      setStarting(false);
    }
  }, [picked, starting, pickingFor, activeRoomId, onChangeParticipants, onStartThread]);

  // PARKED AT THE BOTTOM, where a conversation belongs. Keyed on the message list rather than on every render, so a
  // member reading back through the history is not yanked forward each time somebody types.
  useEffect(() => {
    const node = bodyRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, activeRoomId]);

  const submit = useCallback(async () => {
    if (chatSendProblem({ body: draft, offline, hasGif: Boolean(pendingGif) }) || busy) return;
    setBusy(true);
    try {
      const body = normalizeChatBody(draft);
      // THE PICTURE GOES WITH THE MESSAGE, as the second argument rather than as part of the text - because the server
      // stores it as five fields of its own (functions/chat.js#chatGifFields) and a caption is only ever a caption.
      if (editing) await onEdit?.(editing, body);
      else await onSend?.(body, pendingGif || undefined);
      setDraft('');
      setEditing(null);
      setShowEmoji(false);
      // CLEARED ONLY AFTER IT IS SENT. Clearing before would lose the picture if the send failed, and the member would be
      // left with an empty box and no way to know whether the joke went anywhere.
      setPendingGif(null);
    } finally {
      setBusy(false);
    }
  }, [draft, busy, editing, offline, onEdit, onSend, pendingGif]);

  const startEdit = useCallback((message) => {
    setEditing(message.id);
    setDraft(message.body);
  }, []);

  // THE TWO-PANE LAYOUT, and the flags that keep the narrow one exactly as it was.
  //
  // AT FULL WIDTH the panel is wide enough for the conversation list and a conversation at once: the list becomes a
  // fixed column on the left and the messages take what is left. THE DOCKED PANEL IS NEVER TWO-PANED - it is 24rem wide
  // in the lower right, and there is no room for a list beside anything - which is why every `md:` below is conditional
  // on `fullScreen` rather than on the screen size alone. A viewport that is 1400px wide with the panel docked is still
  // a narrow panel.
  //
  // `showConversation` is the ONE decision both panes read: it is whether a conversation is the thing being looked at,
  // which is false while a picker is open even if a room is selected behind it. On a phone that is today's behaviour
  // exactly - one view at a time - and on a desktop it is what lets the picker appear in the list column while the
  // conversation you are adding somebody to stays visible beside it.
  //
  // THE PANE THAT IS NOT SHOWING IS HIDDEN RATHER THAN UNMOUNTED, which is a deliberate change on narrow screens: the
  // list is in the DOM while you are reading a conversation. It costs a handful of rows nobody is looking at, and it
  // buys two things - the scroll position of the list survives going into a conversation and back out, and the two
  // panes do not have to be two copies of the same markup with the risk that they drift.
  const showConversation = Boolean(activeRoom) && !picking;
  // AND WHY BOTH PANES CARRY `flex-1`, which is not symmetry for its own sake. A flex item defaults to
  // `flex: 0 1 auto`, so a pane that does not ask to grow is sized by its WIDEST CONTENT - and the widest content in a
  // conversation is the message box, which is a `rows={1}` textarea about two hundred pixels wide. The result is a
  // conversation squeezed into a narrow column at the left of a wide empty space, with the bubbles aligning to each
  // other's right edge instead of to the pane's, which is exactly what the two-pane layout looked like the first time it
  // was opened. `flex-1` also restores the narrow layout, where the pane has to fill the height under the header.
  //
  // `md:flex-none` CANCELS the growth for the list, and the pair of them is the whole trick: `flex-1` is `flex: 1 1 0%`,
  // whose grow would make the list swallow half the row, so on a wide screen it must be `flex: none` with an explicit
  // width. `md:shrink-0` alone would have left the grow in place.
  const listPaneClass = `flex min-h-0 flex-1 flex-col ${
    fullScreen ? 'md:w-72 md:flex-none md:border-r md:border-slate-200 md:dark:border-slate-700' : ''
  } ${showConversation ? (fullScreen ? 'hidden md:flex' : 'hidden') : 'flex'}`;
  const conversationPaneClass = `flex min-h-0 flex-1 flex-col ${
    showConversation ? 'flex' : fullScreen ? 'hidden md:flex' : 'hidden'
  }`;

  return (
    <section
      className={
        fullScreen
          ? 'flex h-[70vh] min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
          : 'fixed bottom-4 right-4 z-[55] flex h-[70vh] max-h-[560px] w-[24rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800'
      }
      aria-label="Chat"
    >
      <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
        {/* THE PANEL'S OWN TITLE, which names the column underneath it. The conversation's name is not here any more: it
            moved inside the conversation pane, beside the controls that act on that conversation - see the header there. */}
        <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
          {picking ? 'New conversation' : 'Chat'}
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            // ALWAYS PUSHED RIGHT: this header is the list column's now, so the close control is the only thing on the right
            // of it. It used to lose its `ml-auto` whenever a conversation was open, which was invisible while the two
            // headers were one.
            className="ml-auto rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
            aria-label="Close chat"
            title="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </header>

      {error && (
        <p className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
          {error}
        </p>
      )}

      {/* TWO PANES AT FULL WIDTH: the list on the left, the conversation on the right. Below the breakpoint - and in the
          docked panel at any width - this is one column with one view at a time, which is exactly what it was before. */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* LEFT: the conversations, or a picker when one is being built. A picker belongs in this column rather than over
            the top of the conversation, because it is a list of people and this is where lists live - on a phone it still
            replaces the conversation, which is the one thing `showConversation` decides. */}
        <div className={listPaneClass}>
        {picking ? (
          <ChatPeoplePicker
            people={
              // ADDING ONLY OFFERS PEOPLE WHO ARE NOT ALREADY IN IT. The server treats adding an existing member as a no-op,
              // so this is not a correctness fix - it is the difference between a list you choose from and a list you have to
              // read past to find the people you can actually act on.
              pickingFor === 'add' ? people.filter((person) => !activeMembers.includes(String(person.id))) : people
            }
            loading={peopleLoading}
            picked={picked}
            filter={filter}
            error={pickerError}
            starting={starting}
            presence={presence}
            now={now}
            submitLabel={pickingFor === 'add' ? 'Add to conversation' : ''}
            // `currentMembers` is what turns the picker into the members list - see the note on it in ChatPeoplePicker. Undefined
            // in the other modes, which is what "an array rather than a flag" means in practice.
            currentMembers={pickingFor === 'members' ? otherMembers : undefined}
            onRemove={removeMember}
            onAddPeople={() => {
              setPickingFor('add');
              setPicked([]);
              setFilter('');
              setPickerError('');
            }}
            onFilter={setFilter}
            onToggle={togglePicked}
            onStart={startThread}
            onBack={() => {
              setPicking(false);
              setPicked([]);
              setFilter('');
              setPickerError('');
            }}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {onStartThread && (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="mb-1 flex w-full max-w-sm items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-left text-sm font-medium text-slate-600 transition hover:border-red-400 hover:text-red-700 dark:border-slate-600 dark:text-slate-300 dark:hover:border-red-500 dark:hover:text-red-300"
              >
                <Plus className="h-4 w-4" /> Message a member
              </button>
            )}
            {rooms.length === 0 ? (
              <p className="p-3 text-sm text-slate-500 dark:text-slate-400">
                No rooms yet. An officer sets them up in Administration → Chat Rooms.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {rooms.map((room) => (
                  <ChatRoomRow
                    key={room.id}
                    room={room}
                    title={labelFor(room)}
                    inboxRow={inbox[room.id]}
                    // WHICH CONVERSATION YOU ARE READING, which only became visible information when the list got a
                    // column of its own: with the list and the conversation on screen together, a list that does not
                    // mark where you are is a list you have to match against the heading by eye. It was hard-coded
                    // `false` before, when the list was never on screen beside a conversation.
                    active={String(activeRoom?.id || '') === String(room.id)}
                    onOpen={onOpenRoom}
                    timeFormat={timeFormat}
                  />
                ))}
              </ul>
            )}
          </div>
        )
        }
        </div>

        {/* RIGHT: the conversation, and on a wide screen it is present whether or not one is open - an empty half of a
            two-pane layout reads as broken, so it says what to do instead. On a phone this pane is hidden when nothing is
            open (the list is the whole view there), so the placeholder is never seen and never has to be hidden.
            `data-pane` is FOR THE RENDER HARNESS, and it exists because the list and the conversation are now in the same
            document at once: a check that compares the position of two things on a message ("the tick after the controls,
            before the time") has to be able to say WHICH pane it means, and the room rows carry timestamps of their own. */}
        <div className={conversationPaneClass} data-pane="conversation">
          {!showConversation && (
            <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Choose a conversation, or start one with somebody.
            </p>
          )}
          {showConversation && (
        <>
          {/* THE CONVERSATION'S OWN HEADER, AND IT IS INSIDE THE CONVERSATION.
              It used to be a single bar across the top of the whole panel, which was a heading for the PANEL rather than for
              the thing you are reading - and on a wide screen it named one conversation while the list of them sat
              underneath it, with its own name nowhere. Now the bar over the list says Chat, and this one names the person or
              the room, next to the controls that act on THEM: who is in it, leaving it, muting it. */}
          <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
            {/* BACK TO THE LIST, WHERE THERE IS A LIST TO GO BACK TO: on a phone, and in the docked panel, this pane is the
                whole view - at full width the conversations are already beside it and this control has nothing to do. */}
            <button
              type="button"
              onClick={onCloseRoom}
              className={`rounded-lg px-1.5 py-0.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 ${
                fullScreen ? 'md:hidden' : ''
              }`}
              aria-label="Back to the conversations"
              title="Back to the conversations"
            >
              ‹
            </button>
            <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{labelFor(activeRoom)}</h2>
            {/* WHO ELSE IS HERE. Only drawn for a conversation with a member list - a private conversation, or none at all: a
                station room's audience is a role, and there is no list of people to check against the presence tree. */}
            {activeMembers.length > 0 && (
              <span className="flex shrink-0 items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${activeOnline > 0 ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                  aria-hidden="true"
                />
                {activeOnline > 0 ? `${activeOnline} online` : 'offline'}
              </span>
            )}
            <span className="ml-auto flex items-center gap-1">
              {/* A PRIVATE CONVERSATION CAN BE CHANGED BY THE PEOPLE IN IT. Two controls, and only on a thread: a station
                  room's audience is a role set by an officer, so offering to add somebody to one would be offering something
                  the server refuses (functions/chat.js#chatParticipantProblem). The picker is the same one "Message a member"
                  uses, told what it is for. */}
              {isChatThread(activeRoom) && onChangeParticipants && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setPickingFor('members');
                      setPicked([]);
                      setFilter('');
                      setPickerError('');
                      setPicking(true);
                    }}
                    className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                    aria-label="Who is in this conversation"
                    title="Who is in this conversation"
                  >
                    <Users className="h-4 w-4" />
                  </button>
                  {/* LEAVING NEEDS NO CONFIRMATION, because it is recoverable twice over: the other members can add you back,
                      and starting a conversation with the same people finds the same one (the id is derived from the members),
                      which puts you back in it. What it cannot do is leave a conversation with nobody in it - the server
                      refuses that. */}
                  {onLeaveThread && (
                    <button
                      type="button"
                      onClick={() => onLeaveThread(activeRoom.id)}
                      className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                      aria-label="Leave this conversation"
                      title="Leave this conversation"
                    >
                      <LogOut className="h-4 w-4" />
                    </button>
                  )}
                </>
              )}
              {onToggleMute && (
                <button
                  type="button"
                  onClick={() => onToggleMute(activeRoom.id, !inbox[activeRoom.id]?.muted)}
                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                  aria-label={inbox[activeRoom.id]?.muted ? 'Unmute this conversation' : 'Mute this conversation'}
                  // THE TITLE SAYS THE SAME THING AS THE LABEL, and both follow the state: an icon-only control has to say what
                  // it does on hover AND say what pressing it will do, which for a toggle is the opposite of what it is now.
                  title={inbox[activeRoom.id]?.muted ? 'Unmute this conversation' : 'Mute this conversation'}
                  aria-pressed={Boolean(inbox[activeRoom.id]?.muted)}
                >
                  {inbox[activeRoom.id]?.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
              )}
            </span>
            {/* THE CLOSE CONTROL, IN WHICHEVER HEADER IS THE ONLY ONE SHOWING: the module draws both panes and closes from the
                list's header, while the docked panel has room for one pane at a time and needs one here too - otherwise it
                could not be closed at all while a conversation is open. */}
            {!fullScreen && onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                aria-label="Close chat"
                title="Close chat"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </header>
          <div ref={bodyRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {hasOlder && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={onLoadOlder}
                  disabled={loading}
                  className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {loading ? 'Loading…' : 'Load older messages'}
                </button>
              </div>
            )}
            {messages.length === 0 && !loading && (
              <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                Nothing here yet. Say something.
              </p>
            )}
            <ul className="space-y-2">
              {messages.map((message) => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  mine={message.author_id === mine}
                  flags={flags}
                  currentUser={currentUser}
                  timeFormat={timeFormat}
                  ranks={ranks}
                  // THE RECEIPT, worked out here rather than in the bubble: it is a question about the CONVERSATION (who else is
                  // in it) and the viewer as much as about the message, and the bubble is handed the answer instead of the three
                  // things it would need to work it out. Only for your own messages, and only where a receipt means something -
                  // `deliveryStateFor` returns nothing for anybody else's.
                  delivery={
                    message.author_id === mine && isChatThread(activeRoom)
                      ? deliveryStateFor({ message, readAt, viewerId: mine, conversation: activeRoom })
                      : ''
                  }
                  onEdit={startEdit}
                  onDelete={(row) => onDelete?.(row)}
                  onReact={onReact}
                />
              ))}
            </ul>
          </div>

          <div className="relative border-t border-slate-200 p-2 dark:border-slate-700">
            {editing && (
              <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <Pencil className="h-3 w-3" /> Editing
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setDraft('');
                  }}
                  className="ml-auto underline"
                >
                  cancel
                </button>
              </div>
            )}
            {/* WHO IS TYPING, immediately above the box they will be typing INTO - the one place a member is already looking
                when it matters. It renders NOTHING AT ALL when nobody is, so the composer never moves for it: this line comes
                and goes several times a minute in a busy conversation, and a send button that shifted each time would be the
                cost of a nicer-looking one. `aria-live` because it is the only part of the conversation that changes without
                a message arriving. */}
            {typingLabel && (
              <p className="mb-1 px-1 text-[11px] italic text-slate-500 dark:text-slate-400" aria-live="polite">
                {typingLabel}
              </p>
            )}
            {/* THE PICTURE WAITING TO BE SENT, shown as itself rather than as a filename: the whole reason it is held here
                instead of sent on pick is that somebody can see what they are about to say before they say it. */}
            {pendingGif && (
              <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-200 p-2 dark:border-slate-600">
                <img
                  src={pendingGif.url}
                  alt={pendingGif.alt || 'The chosen picture'}
                  className="h-16 w-16 shrink-0 rounded-lg object-cover"
                />
                <p className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">
                  {pendingGif.alt || 'A picture will be sent with this message.'}
                </p>
                <button
                  type="button"
                  onClick={() => setPendingGif(null)}
                  aria-label="Remove the picture"
                  title="Remove the picture"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setShowGifs((open) => !open);
                  // ONE PICKER AT A TIME: two panels opening over the same composer would cover each other and the message
                  // being written, and the emoji one is the size of a phone keypad.
                  setShowEmoji(false);
                }}
                aria-expanded={showGifs}
                aria-label="Send a picture"
                title="Send a picture"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <Film className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowEmoji((open) => !open)}
                aria-expanded={showEmoji}
                aria-label="Emoji"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <Smile className="h-4 w-4" />
              </button>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  // ENTER SENDS, SHIFT+ENTER is a new line - the arrangement every chat has, and the reason this is a
                  // textarea with a keyboard rule rather than an input.
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                rows={1}
                placeholder={`Message ${activeRoom.name}`}
                className="max-h-28 min-h-[2.5rem] flex-1 resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-red-400 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={Boolean(problem) || busy}
                aria-label="Send"
                className="rounded-xl bg-red-600 p-2.5 text-white transition hover:bg-red-500 disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            {/* SHOWN WHEN THERE IS SOMETHING TO SAY: a body problem once something has been typed, but being offline as
                soon as the room is open - a member should not have to type a sentence to find out it cannot go. */}
            {(offline || draft) && problem && (
              <p className="mt-1 px-1 text-[11px] text-amber-700 dark:text-amber-300">{problem}</p>
            )}
            {showEmoji && (
              <EmojiPicker
                // `align="left"` BECAUSE OF WHERE THE BUTTON IS: the picker hangs off this composer, which is positioned, and
                // the smiley sits at its left edge beside the picture button. Left-aligned it opens directly above them;
                // right-aligned - the default, and what it used to do - it opened above the SEND button at the far end,
                // a hand's width from the control that was clicked.
                align="left"
                onClose={() => setShowEmoji(false)}
                onPick={(emoji) => setDraft((current) => `${current}${emoji}`)}
              />
            )}
            {showGifs && (
              <GifPicker
                onClose={() => setShowGifs(false)}
                onPick={(asset) => {
                  setPendingGif(asset);
                  // AND THE EMOJI PICKER GETS OUT OF THE WAY when a picture is chosen, because the next thing somebody does
                  // is look at the message box to type a caption under it.
                  setShowEmoji(false);
                }}
              />
            )}
          </div>
        </>
          )}
        </div>
      </div>
    </section>
  );
}

