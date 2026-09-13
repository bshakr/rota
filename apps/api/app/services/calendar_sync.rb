# One pass over one house's calendar: fetch, parse, classify, upsert, prune. Failures are recorded
# on the connection rather than raised, so the hourly job and the admin's "Sync now" both see the
# same plain-words outcome. Stale rows are kept on failure: a calendar that was right yesterday
# beats an empty one.
class CalendarSync
  PAST_DAYS = 7
  FUTURE_DAYS = 90
  DISABLE_AFTER_GONE = 3
  DISABLE_AFTER_ANY = 48

  # What the admin reads when the failure is one we have not given words to. Every class below is
  # covered, so this is only ever reached by a subclass added after this file was written, and a
  # dull sentence beats a KeyError that would turn a recorded failure into a failed sync.
  UNREADABLE = "Couldn't read the calendar."

  MESSAGES = {
    CalendarFetch::Gone => "Google says this link no longer works. Paste a new secret address.",
    CalendarFetch::Unreachable => "Couldn't reach the calendar.",
    CalendarFetch::InvalidUrl => "Paste the full https link.",
    CalendarFetch::TooLarge => "The calendar feed is too large to read (over 5 MB).",
    CalendarParser::NotACalendar => "That link isn't a calendar feed."
  }.freeze

  def self.window_for(group)
    today = group.today
    [ today - PAST_DAYS, today + FUTURE_DAYS ]
  end

  def initialize(connection)
    @connection = connection
  end

  # `fetched` is a CalendarFetch::Result the caller already has. CalendarConnect proves a pasted
  # link works by downloading it, and then hands the body over rather than asking Google for the
  # same calendar twice in one request.
  def call(fetched: nil)
    result = fetched || CalendarFetch.call(connection.ical_url, etag: connection.etag, last_modified: connection.last_modified)
    if result.status == :not_modified
      # A 304 is a successful fetch: Google answered, and the calendar has not changed. So it ends a
      # run of failures too. record_failure! leaves the stored ETag in place, so a connection that
      # has failed three times keeps asking conditionally and keeps getting 304s, and leaving the
      # counter alone would have the dashboard say the calendar isn't syncing every hour until
      # somebody happened to edit an event.
      #
      # Deliberately not record_success!, which would also stamp last_synced_at for a pass that
      # synced nothing, and lift disabled_at, which only "Sync now" and a new link may do.
      connection.update!(last_fetched_at: Time.current, consecutive_failures: 0, last_error: nil)
      return connection
    end

    from, to = self.class.window_for(group)
    parser = CalendarParser.new(result.body, zone: group.time_zone, from: from, to: to)
    stored = store(parser.occurrences)
    connection.record_success!(calendar_name: parser.calendar_name, etag: result.etag,
                               last_modified: result.last_modified, events_count: stored)
    connection
  rescue CalendarFetch::Error, CalendarParser::NotACalendar => e
    record_failure(e)
    connection
  end

  private

  attr_reader :connection

  def group = connection.group

  # Spec section 6 step 5. The count drives both cut-offs: a reset secret address is never coming
  # back, so three tries is enough, while anything else gets two days of hourly retries first.
  def record_failure(error)
    failures = connection.consecutive_failures + 1
    disable = (error.is_a?(CalendarFetch::Gone) && failures >= DISABLE_AFTER_GONE) || failures >= DISABLE_AFTER_ANY
    connection.record_failure!(MESSAGES.fetch(error.class, UNREADABLE), disable: disable)
    # CalendarFetch and CalendarParser both promise their messages never carry the link, which is
    # the only reason this line can print one.
    Rails.logger.warn("CalendarSync failed for connection #{connection.id}: #{error.class}: #{error.message}")
  end

  # Spec section 6 step 3 and 4. Fingerprint everything, reuse every verdict the house already has,
  # ask Claude only about what is left, then write the lot in one transaction. The model call is
  # deliberately outside that transaction: it can take twenty seconds.
  def store(occurrences)
    now = Time.current
    classifier = CalendarClassifier.new(members: group.members.active.to_a)
    # uniq on the key because the feed is remote input: two VEVENTs sharing a UID and a start are
    # malformed but perfectly possible, and Postgres refuses an ON CONFLICT statement that would
    # touch one row twice. Dropping the second is the only sane reading, and a crash here would
    # escape this class's promise that a bad feed is recorded rather than raised.
    printed = occurrences.uniq(&:instance_key).map do |occurrence|
      [ occurrence, classifier.fingerprint(summary: occurrence.summary, all_day: occurrence.all_day,
                                           starts_on: occurrence.starts_on, ends_on: occurrence.ends_on) ]
    end

    verdicts = stored_verdicts(printed.map(&:last).uniq)
    verdicts.merge!(fresh_verdicts(classifier, printed, verdicts.keys))

    CalendarEvent.transaction do
      upsert_rows(printed, verdicts, now)
      prune(printed)
      relink(printed, verdicts)
    end
    printed.size
  end

  # Instances that left the feed: deleted, cancelled, retitled onto a new key, or fallen out of the
  # 97-day window. A row survives exactly when this pass wrote it, so the keys this pass wrote are
  # the whole test. Deliberately not "synced_at < now", which spec section 6 step 4 suggests: two
  # syncs inside one clock tick then prune nothing, because the earlier pass already stamped those
  # rows with the same instant. An empty feed leaves no keys and clears the connection, which is
  # what an emptied calendar means.
  def prune(printed)
    connection.calendar_events.where.not(instance_key: printed.map { |occurrence, _| occurrence.instance_key }).delete_all
  end

  # A verdict depends only on the title, the shape of the entry and the roster, all of which the
  # fingerprint carries, so a title the house already has is never sent twice: weekly bins are
  # classified once, not once a week. Read before the upsert, so these are the previous run's rows.
  # Most recently classified wins if two rows somehow share a fingerprint.
  def stored_verdicts(fingerprints)
    return {} if fingerprints.empty?

    connection.calendar_events.classified.where(fingerprint: fingerprints)
      .includes(:calendar_event_members).order(:classified_at)
      .each_with_object({}) do |event, found|
        found[event.fingerprint] = CalendarClassifier::Verdict.new(
          kind: event.kind, member_ids: event.calendar_event_members.map(&:member_id), reason: event.reason
        )
      end
  end

  # Only the fingerprints with no stored verdict, de-duplicated, so a hundred instances of one
  # recurring title are one line in the request.
  def fresh_verdicts(classifier, printed, known)
    wanted = printed.map(&:last).uniq - known
    return {} if wanted.empty?

    by_print = printed.to_h { |occurrence, fingerprint| [ fingerprint, occurrence ] }
    classifier.classify(wanted.map { |fingerprint|
      occurrence = by_print.fetch(fingerprint)
      { ref: fingerprint, summary: occurrence.summary, all_day: occurrence.all_day,
        starts_on: occurrence.starts_on, ends_on: occurrence.ends_on }
    })
  rescue CalendarClassifier::Failed => e
    # Spec 7.4: a failed call is never a failed sync. The classifier attempts every chunk and hands
    # back what did come through on #verdicts, so a 429 on the last chunk of a first connect no
    # longer throws away the hundred verdicts before it. The rest stay pending and the next run
    # asks again. The log line carries the classifier's message, which by construction is the
    # cause's class and error type and never a title.
    Rails.logger.warn("CalendarSync could not classify #{wanted.size - e.verdicts.size} of " \
                      "#{wanted.size} titles for connection #{connection.id}: #{e.class}: #{e.message}")
    Rails.error.report(e, context: { calendar_connection_id: connection.id }, source: "rotamonster.calendar_classifier")
    e.verdicts
  end

  # upsert_all skips validations, so every row carries every NOT NULL column the table has; the
  # database constraints are the guard here, not the model.
  #
  # record_timestamps: false because this pass owns the clock. Left on, Rails adds its own
  # updated_at assignment to the conflict clause on top of the one in update_only, and Postgres
  # rejects the statement outright ("multiple assignments to same column"). Every row is stamped
  # with one instant, so synced_at reads as "last confirmed in the feed" for the whole pass.
  def upsert_rows(printed, verdicts, now)
    return if printed.empty?

    rows = printed.map do |occurrence, fingerprint|
      verdict = verdicts[fingerprint]
      { calendar_connection_id: connection.id, uid: occurrence.uid, instance_key: occurrence.instance_key,
        summary: occurrence.summary, starts_on: occurrence.starts_on, ends_on: occurrence.ends_on,
        starts_at: occurrence.starts_at, ends_at: occurrence.ends_at, all_day: occurrence.all_day,
        kind: verdict&.kind || "event", fingerprint: fingerprint, reason: verdict&.reason,
        classified_at: verdict ? now : nil, synced_at: now, created_at: now, updated_at: now }
    end
    CalendarEvent.upsert_all(rows, unique_by: %i[calendar_connection_id instance_key],
                                   record_timestamps: false,
                                   update_only: %i[uid summary starts_on ends_on starts_at ends_at all_day
                                                   kind fingerprint reason classified_at synced_at updated_at])
  end

  # Rewritten rather than diffed: an away verdict names at most a few members, and the join rows for
  # one house's calendar are a handful either way.
  def relink(printed, verdicts)
    ids_by_key = connection.calendar_events.pluck(:instance_key, :id).to_h
    CalendarEventMember.where(calendar_event_id: ids_by_key.values).delete_all
    links = printed.flat_map do |occurrence, fingerprint|
      verdict = verdicts[fingerprint]
      next [] if verdict.nil?

      verdict.member_ids.map { |member_id| { calendar_event_id: ids_by_key.fetch(occurrence.instance_key), member_id: member_id } }
    end
    CalendarEventMember.insert_all(links) if links.any?
  end
end
