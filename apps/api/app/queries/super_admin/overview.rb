module SuperAdmin
  # Everything the operator's landing page shows, in one Hash: KPI tiles, the attention list, the
  # last ten houses with how far each got, and the health of the recurring jobs.
  #
  # The first query object in the app, and the start of the `app/queries` convention the plan asks
  # for (`SuperAdmin::Traffic` and `SuperAdmin::Spend` follow). It belongs here rather than in
  # app/services because it is the other half of that pair: services CHANGE something for one house,
  # and this reads across every house and changes nothing. Nothing in this file writes, and the
  # request spec holds that line.
  #
  # Deliberately unscoped. Reading across every tenant is the whole point of the super admin area,
  # which is exactly why it lives beside `TenantScoped` rather than inside it — see
  # SuperAdmin::BaseController. Nothing here takes a parameter from the caller, so there is no id
  # for a house admin to smuggle across the boundary: the allowlist is the only gate, and it is
  # checked before this is ever reached.
  #
  # Live SQL, cached for a minute (plan, "Aggregation"). Tens of houses, not thousands; rollups are
  # a thing to add when a page takes over 500ms, not before.
  class Overview
    # Versioned because Solid Cache survives a deploy. Without the suffix, the sixty seconds after
    # shipping a change to this payload would serve the OLD shape to the NEW page, which is a
    # confusing way to break a dashboard. Bump it whenever the shape changes.
    CACHE_KEY = "super_admin/overview/v1".freeze
    CACHE_TTL = 60.seconds

    # A house is "active" if a text actually reached it in the window (plan, Traffic: "active houses
    # (a delivered text in the window)"). Delivery, not sending: a house whose every text bounces is
    # not a house that is being served.
    ACTIVE_WINDOW = 30.days
    # The window for the text tiles and for failures.
    TEXT_WINDOW = 7.days
    # How long a house gets to finish a step before the attention list starts asking about it. A
    # house that made a rota this morning is mid-onboarding, not stuck.
    STALE_AFTER = 7.days
    RECENT_HOUSES = 10
    # The attention list is a queue of work, and a queue nobody could finish is not a queue. One bad
    # week across three hundred houses must not turn the landing page into a thousand-row scroll, so
    # the rows are capped and the payload carries the true total beside them.
    ATTENTION_LIMIT = 50

    # Ordered by the cost of ignoring them (plan, Overall dashboard). A house that qualifies under
    # more than one reason appears ONCE, under the first — the list is a queue of things to do, and
    # the same house listed four times is four times the noise for one piece of work.
    REASONS = %w[failed_texts unconfirmed_timezone only_draft_rotas opted_out_member].freeze

    # The onboarding ladder, in order, as far as it can be derived from what exists today.
    #
    # The plan's funnel (Traffic dashboard) has eight steps and this is steps 3 to 8. Step 1,
    # landing views, needs the `page_views` table that is Phase 5. Step 2, signed in, needs
    # `sign_ins`, which is https://linear.app/bloombase/issue/BLO-1671 and not on main yet. Neither
    # is derivable from any table this app has, so a house's furthest step starts at "made a house"
    # and the two steps before it are simply absent rather than guessed at.
    FUNNEL_STEPS = %w[
      made_house confirmed_timezone added_member started_rota delivered_text first_cover
    ].freeze

    # The payload, from cache when it is less than a minute old.
    #
    # The key names no user on purpose: every super admin sees the same numbers, so one cached copy
    # serves all of them, and a per-user key would mean a per-user minute of staleness and N copies
    # of an identical payload.
    def self.call
      Rails.cache.fetch(CACHE_KEY, expires_in: CACHE_TTL) { new.call }
    end

    def initialize(now: Time.current)
      # One clock for the whole payload. Read separately, the KPI tiles and the attention list
      # could straddle a week boundary and disagree with each other about what "this week" is.
      @now = now
    end

    def call
      flagged = attention_rows

      {
        generated_at: now,
        kpis: kpis,
        # Capped, with the count before the cap beside it, so the page can say "50 of 312" rather
        # than quietly implying that fifty is all there is.
        attention: flagged.first(ATTENTION_LIMIT),
        attention_total: flagged.length,
        recent_houses: recent_houses,
        system_health: system_health,
        # Texts and Claude, this month against last. The collectors landed with BLO-1672 and
        # BLO-1673, but the money is its own query object and its own ticket:
        # https://linear.app/bloombase/issue/BLO-1683. Present and null so the page can render the
        # tile's empty state now rather than growing a key later.
        #
        # When that lands, fill this key from `SuperAdmin::Spend.cached(range: "90d")` rather than
        # adding a second one. Its `months` array runs oldest first, so `months[-1]` is this month
        # so far and `months[-2]` is last month, whole.
        #
        # Ask for 90d and NOT 30d. A 30-day window starts mid-month, so its `months[-2]` covers only
        # the part of last month that fell inside the window — last month's total would read low,
        # silently, by a different amount every day of the month. 90d always reaches back past the
        # first of last month, so that bucket is a complete calendar month. 12m has the same
        # property, if the page would rather share one cache entry with the spend page's default.
        #
        # Two things the tile must not do with those figures. `sms_cost_settled` (what Twilio has
        # actually charged) and `sms_cost_estimated` (segments priced at an assumed rate, because
        # Twilio has not settled them yet) are separate deliberately, and must not be added into one
        # "texts" number without saying that part of it is an estimate — `sms_cost` is the combined
        # figure for when one number is genuinely wanted. And that money arrives already rounded for
        # display, so nothing downstream rounds it a second time.
        spend: nil
      }
    end

    private

    attr_reader :now

    # The server thinks in UTC (config.time_zone) and houses do not, so "this week" here is the
    # operator's week — Monday 00:00 UTC — and not any one house's. A global counter cannot be in
    # thirty local weeks at once, and the operator reading it is in one place.
    def week_start = now.beginning_of_week

    def texts_since = now - TEXT_WINDOW

    def stale_before = now - STALE_AFTER

    def kpis
      # One grouped query answers the total, the delivered count and the failed count together.
      by_status = SmsMessage.where(created_at: texts_since..).group(:status).count
      delivered = by_status["delivered"].to_i
      failed = by_status["failed"].to_i

      {
        houses_total: Group.count,
        houses_active_last_30_days: active_house_count,
        houses_new_this_week: Group.where(created_at: week_start..).count,
        texts_last_7_days: by_status.values.sum,
        texts_delivered_last_7_days: delivered,
        texts_failed_last_7_days: failed,
        # The rate's denominator, published beside it so the page can render "96.4% of 412 settled"
        # and a reader can tell 96.4% of twelve texts from 96.4% of four hundred. Excludes rows
        # still in flight: `pending`, `sending`, and `sent` rows the carrier has never sent a final
        # receipt for.
        texts_settled_last_7_days: delivered + failed,
        delivery_rate_last_7_days: delivery_rate(delivered, failed),
        covers_this_week: SmsMessage.cover_notice.where(created_at: week_start..).count
      }
    end

    def active_house_count
      Group.joins(members: :sms_messages)
        .where(sms_messages: { status: "delivered", created_at: (now - ACTIVE_WINDOW).. })
        .distinct.count
    end

    # Delivered as a share of the texts whose fate is settled — delivered plus failed.
    #
    # The denominator deliberately excludes rows still in flight (`pending`, `sending`, and `sent`
    # waiting on a receipt). The sweep lays down a batch of pending rows on the hour, so counting
    # them would drop the rate every hour and recover it minutes later, and an operator cannot tell
    # that kind of sawtooth apart from a real delivery problem. Rendered to ONE DECIMAL, never a
    # whole percent: 96.4 is the number the data supports and 96 is not (project rule).
    #
    # Null, not zero, when nothing has settled: "no texts yet" and "none of them arrived" are
    # opposite facts and must not render as the same tile.
    def delivery_rate(delivered, failed)
      settled = delivered + failed
      return nil if settled.zero?

      ((delivered.to_f / settled) * 100).round(1)
    end

    # Houses that need a human, in REASONS order, each house once under the first reason it hits.
    # Uncapped: `call` takes the first ATTENTION_LIMIT and publishes the full length beside them.
    def attention_rows
      by_reason = {
        "failed_texts" => failed_text_counts,
        "unconfirmed_timezone" => unconfirmed_timezone_ids.index_with(nil),
        "only_draft_rotas" => draft_only_rota_counts,
        "opted_out_member" => opted_out_member_counts
      }

      names = group_names(by_reason.values.flat_map(&:keys).uniq)
      claimed = Set.new

      REASONS.flat_map do |reason|
        counts = by_reason.fetch(reason).except(*claimed)
        claimed.merge(counts.keys)

        # Worst first inside a reason, then by id so the order never moves between two calls that
        # see the same data — the page links each row to a group id and a list that reshuffles under
        # the reader is its own small bug.
        counts.sort_by { |group_id, count| [ -count.to_i, group_id ] }.filter_map do |group_id, count|
          group = names[group_id]
          next if group.nil?

          { group_id: group_id, name: group[:name], slug: group[:slug], reason: reason, count: count }
        end
      end
    end

    # Houses whose texts are failing. The one reason that is always someone's fault — a wrong
    # country code, a number that has been disconnected, a template that will not render — and
    # always costs a real person their reminder, which is why it leads the list.
    def failed_text_counts
      Member.joins(:sms_messages)
        .where(sms_messages: { status: "failed", created_at: texts_since.. })
        .group(:group_id).count
    end

    # A house created as UTC because a JIT-provisioned group has no timezone to take, and never
    # corrected. Every reminder it sends is at the wrong hour, silently, and it will drift by
    # another hour when the clocks change. No count: the fact is the whole story.
    def unconfirmed_timezone_ids
      Group.where(timezone_confirmed_at: nil).where(created_at: ...stale_before).pluck(:id)
    end

    # A house with ACTIVE rotas, none of which has anybody on it, and none made recently. That is
    # the shape of an onboarding that stopped halfway: somebody set up a chore and never added the
    # housemates, so not one text will ever go out.
    #
    # Two houses are deliberately not here. One with no rotas at all has not started, which is what
    # the recent-houses funnel is for rather than a thing to chase. And one whose only empty rota is
    # DEACTIVATED has already been dealt with — switching a rota off is somebody deciding they do
    # not want it, which is an answer, not a stall, and nagging about it would train the operator to
    # scroll past this list.
    def draft_only_rota_counts
      Rota.active.left_joins(:rota_positions)
        .group(:group_id)
        .having("COUNT(rota_positions.id) = 0")
        .having("MAX(rotas.created_at) < ?", stale_before)
        .count("DISTINCT rotas.id")
    end

    # Somebody still on a rota who has replied STOP. They are taking turns nobody is telling them
    # about, so the house's schedule is quietly wrong for everyone else too.
    def opted_out_member_counts
      Member.active.where.not(sms_opted_out_at: nil).group(:group_id).count
    end

    # `live` only (BLO-1675). A paused house is not a thing to chase — its texts are stopped, its
    # timezone does not matter until somebody resumes it, and the operator who paused it does not
    # want their own decision back on the list of things to do. `attention_rows` drops any id this
    # does not name, so one `live` here takes a suspended house out of all four reasons AND out of
    # `attention_total`, rather than leaving the count disagreeing with the rows beneath it.
    def group_names(ids)
      return {} if ids.empty?

      Group.live.where(id: ids).pluck(:id, :name, :slug)
        .to_h { |id, name, slug| [ id, { name: name, slug: slug } ] }
    end

    # The last ten houses made, each with the furthest rung of the onboarding ladder it reached, so
    # an onboarding that stalled is visible the day it happens rather than in a monthly total.
    def recent_houses
      groups = Group.order(created_at: :desc, id: :desc).limit(RECENT_HOUSES).to_a
      return [] if groups.empty?

      ids = groups.map(&:id)
      # Four set queries rather than four per house: ten houses is still ten round trips, and this
      # is the page every operator lands on.
      with_member = Member.where(group_id: ids).distinct.pluck(:group_id).to_set
      with_roster = Rota.joins(:rota_positions).where(group_id: ids).distinct.pluck(:group_id).to_set
      with_delivered = delivered_reminder_group_ids(ids)
      with_cover = cover_notice_group_ids(ids)

      groups.map do |group|
        step = furthest_step(group, with_member, with_roster, with_delivered, with_cover)

        {
          group_id: group.id,
          name: group.name,
          slug: group.slug,
          timezone: group.timezone,
          timezone_confirmed: group.timezone_confirmed?,
          created_at: group.created_at,
          furthest_step: step,
          # 1-based within the ladder above, so the page can draw six pips without owning the list.
          furthest_step_number: FUNNEL_STEPS.index(step) + 1
        }
      end
    end

    # The plan's step 7: a reminder the carrier confirmed, which is the first moment the product has
    # actually done its job for a house. A `sent` reminder is not it — nobody has been told anything
    # until it arrives.
    def delivered_reminder_group_ids(ids)
      Member.joins(:sms_messages)
        .where(group_id: ids, sms_messages: { kind: "reminder", status: "delivered" })
        .distinct.pluck(:group_id).to_set
    end

    # The plan's step 8, and the product's one real engagement signal: a housemate swapped a turn
    # with another housemate, which means the rota is being lived with rather than merely received.
    # Any cover notice counts, whatever became of the text — the cover happened either way.
    def cover_notice_group_ids(ids)
      Member.joins(:sms_messages)
        .where(group_id: ids, sms_messages: { kind: "cover_notice" })
        .distinct.pluck(:group_id).to_set
    end

    # Furthest, not latest: the highest rung reached, whether or not the ones below it were. A house
    # that is texting reminders has plainly got past "added a member" even if its timezone was never
    # confirmed, so the ladder is read from the top down.
    def furthest_step(group, with_member, with_roster, with_delivered, with_cover)
      return "first_cover" if with_cover.include?(group.id)
      return "delivered_text" if with_delivered.include?(group.id)
      return "started_rota" if with_roster.include?(group.id)
      return "added_member" if with_member.include?(group.id)
      return "confirmed_timezone" if group.timezone_confirmed?

      "made_house"
    end

    # When each recurring job last finished, and how badly the queue is backed up.
    #
    # Reading this from job_runs rather than from Solid Queue is the point of that table:
    # `clear_solid_queue_finished_jobs` deletes Solid Queue's own record of every finished job every
    # hour at minute 12 (config/recurring.yml), so the interesting case — "the sweep stopped running
    # some time yesterday" — is precisely the one it has already erased.
    def system_health
      latest = JobRun.latest_by_name

      {
        jobs: JobRun::MONITORED.map do |name|
          run = latest[name]

          {
            name: name,
            # Null means never finished once. For a job scheduled hourly that is the loudest thing
            # this tile can say, so the row appears whether or not there is a run behind it.
            last_finished_at: run&.finished_at,
            succeeded: run&.succeeded,
            error_class: run&.error_class
          }
        end,
        queue_failed_executions: queue_failed_executions
      }
    end

    # Solid Queue keeps its own tables in a SEPARATE database (config/database.yml), so this is the
    # one read on the page that can fail on its own — a queue database that is unreachable, or a
    # Solid Queue upgrade mid-deploy. That is a reason to show the health tile with one unknown
    # figure, never to fail the whole dashboard: the other half of this payload is exactly what an
    # operator needs when something is wrong with the queue.
    def queue_failed_executions
      SolidQueue::FailedExecution.count
    rescue StandardError => e
      Rails.logger.error("SuperAdmin::Overview could not read the queue's failed executions: " \
                         "#{e.class}: #{e.message}")
      Rails.error.report(e, source: "rotamonster.super_admin_overview")
      nil
    end
  end
end
