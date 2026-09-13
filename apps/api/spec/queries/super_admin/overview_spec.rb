require "rails_helper"

# The operator's landing page, as SQL. Every figure here is read across every tenant on purpose —
# that is what the super admin area is — so the assertions are deliberately global counts, which
# only works because the test database is never seeded (see the "Setup" step in config/ci.rb).
RSpec.describe SuperAdmin::Overview do
  # A Wednesday, so "this week" starts on Monday 2026-09-14 00:00 UTC and there is somewhere for a
  # "last week" row to sit. Seven days back is 2026-09-09 12:00; thirty days back is 2026-08-17.
  # A `let` rather than a constant: a constant assigned inside this block would land on Object and
  # be visible to every other spec file in the suite.
  let(:now) { Time.utc(2026, 9, 16, 12, 0, 0) }

  around { |example| travel_to(now) { example.run } }

  subject(:payload) { described_class.new.call }

  # A text for a house, with its own rota and shift. The rota is created at `now`, so it never trips
  # the "only draft rotas older than 7 days" reason by accident.
  def text_for(group, status: "delivered", kind: "reminder", created_at: nil, days_before: 0)
    created_at ||= now
    shift = create(:shift, rota: create(:rota, group: group))

    if kind == "cover_notice"
      create(:sms_message, :cover_notice, shift: shift, status: status, created_at: created_at)
    else
      create(:sms_message, shift: shift, status: status, created_at: created_at, days_before: days_before)
    end
  end

  # A house that is doing nothing wrong: timezone confirmed, no rotas, nobody opted out.
  def settled_group(**attributes)
    create(:group, timezone_confirmed_at: 1.day.ago, **attributes)
  end

  describe "KPI tiles" do
    it "counts every house" do
      create_list(:group, 3)

      expect(payload[:kpis][:houses_total]).to eq(3)
    end

    # Active means a text actually ARRIVED in the window. A house whose every text bounces is not a
    # house being served, and a house that has gone quiet for a month is the thing this tile exists
    # to make visible.
    it "counts a house as active only on a delivered text inside the last 30 days" do
      text_for(settled_group, status: "delivered", created_at: now - 5.days)
      text_for(settled_group, status: "delivered", created_at: now - 40.days)
      text_for(settled_group, status: "failed", created_at: now - 2.days)
      settled_group

      expect(payload[:kpis][:houses_active_last_30_days]).to eq(1)
    end

    it "counts a house once however many texts it had" do
      group = settled_group
      text_for(group, created_at: now - 1.day)
      text_for(group, created_at: now - 2.days)

      expect(payload[:kpis][:houses_active_last_30_days]).to eq(1)
    end

    it "counts houses made since Monday" do
      create(:group, created_at: now - 1.day)  # Tuesday, this week
      create(:group, created_at: Time.utc(2026, 9, 14, 0, 0, 0)) # Monday midnight, the boundary
      create(:group, created_at: Time.utc(2026, 9, 13, 23, 59, 0)) # Sunday, last week

      expect(payload[:kpis][:houses_new_this_week]).to eq(2)
      expect(payload[:kpis][:houses_total]).to eq(3)
    end

    it "counts texts in the last 7 days and rates them to one decimal" do
      group = settled_group
      5.times { |n| text_for(group, status: "delivered", created_at: now - n.hours) }
      2.times { |n| text_for(group, status: "failed", created_at: now - n.days) }
      text_for(group, status: "pending", created_at: now - 1.hour)
      text_for(group, status: "delivered", created_at: now - 8.days)

      kpis = payload[:kpis]

      expect(kpis[:texts_last_7_days]).to eq(8)
      expect(kpis[:texts_delivered_last_7_days]).to eq(5)
      expect(kpis[:texts_failed_last_7_days]).to eq(2)
      # 5 of the 7 settled texts arrived. 71.4, never 71 — a rate renders at the precision the data
      # supports (project rule).
      expect(kpis[:delivery_rate_last_7_days]).to eq(71.4)
    end

    # "No texts yet" and "none of them arrived" are opposite facts; a zero would render them the same.
    it "leaves the delivery rate null when nothing has settled" do
      text_for(settled_group, status: "pending", created_at: now - 1.hour)

      expect(payload[:kpis][:delivery_rate_last_7_days]).to be_nil
      expect(payload[:kpis][:texts_last_7_days]).to eq(1)
    end

    it "counts cover notices raised since Monday" do
      group = settled_group
      text_for(group, kind: "cover_notice", created_at: now - 1.day)
      text_for(group, kind: "cover_notice", created_at: now - 2.days)
      text_for(group, kind: "cover_notice", created_at: Time.utc(2026, 9, 13, 12, 0, 0))
      text_for(group, kind: "reminder", created_at: now - 1.day)

      expect(payload[:kpis][:covers_this_week]).to eq(2)
    end

    it "answers zeroes rather than nils for an empty world" do
      expect(payload[:kpis]).to include(
        houses_total: 0,
        houses_active_last_30_days: 0,
        houses_new_this_week: 0,
        texts_last_7_days: 0,
        texts_delivered_last_7_days: 0,
        texts_failed_last_7_days: 0,
        covers_this_week: 0,
        delivery_rate_last_7_days: nil
      )
    end
  end

  describe "the attention list" do
    # One house per reason, each carefully clear of the other three.
    let!(:failing) do
      settled_group(name: "Failing").tap do |group|
        text_for(group, status: "failed", created_at: now - 1.day)
        text_for(group, status: "failed", created_at: now - 2.days)
      end
    end

    let!(:drifting) { create(:group, name: "Drifting", created_at: now - 10.days, timezone_confirmed_at: nil) }

    let!(:stalled) do
      settled_group(name: "Stalled", created_at: now - 20.days).tap do |group|
        create(:rota, group: group, created_at: now - 10.days)
      end
    end

    let!(:muted) do
      settled_group(name: "Muted").tap do |group|
        create(:member, group: group, active: true, sms_opted_out_at: now - 1.day)
      end
    end

    def rows_for(group) = payload[:attention].select { |row| row[:group_id] == group.id }

    it "lists the reasons in the plan's order, worst cost of ignoring first" do
      expect(payload[:attention].map { |row| row[:reason] }).to eq(
        %w[failed_texts unconfirmed_timezone only_draft_rotas opted_out_member]
      )
    end

    it "names each house by id, name and slug so a row can link straight to it" do
      expect(rows_for(failing).sole).to include(
        group_id: failing.id, name: "Failing", slug: failing.slug, reason: "failed_texts", count: 2
      )
    end

    it "counts the opted-out members and the stranded draft rotas" do
      expect(rows_for(stalled).sole).to include(reason: "only_draft_rotas", count: 1)
      expect(rows_for(muted).sole).to include(reason: "opted_out_member", count: 1)
    end

    # An unconfirmed timezone is a fact, not a quantity.
    it "carries no count for an unconfirmed timezone" do
      expect(rows_for(drifting).sole).to include(reason: "unconfirmed_timezone", count: nil)
    end

    it "leaves a healthy house off the list entirely" do
      healthy = settled_group(name: "Healthy")
      text_for(healthy, status: "delivered", created_at: now - 1.day)

      expect(rows_for(healthy)).to be_empty
    end

    # The list is a queue of work, and one house listed four times is four times the noise for one
    # piece of work.
    it "lists a house that qualifies twice only once, under the first reason" do
      both = settled_group(name: "Both")
      text_for(both, status: "failed", created_at: now - 1.day)
      create(:member, group: both, active: true, sms_opted_out_at: now - 1.day)

      expect(rows_for(both).sole).to include(reason: "failed_texts")
      expect(payload[:attention].count { |row| row[:reason] == "opted_out_member" }).to eq(1)
    end

    it "puts the worst house first inside a reason" do
      worse = settled_group(name: "Worse")
      3.times { |n| text_for(worse, status: "failed", created_at: now - n.hours) }

      failing_rows = payload[:attention].select { |row| row[:reason] == "failed_texts" }

      expect(failing_rows.map { |row| row[:count] }).to eq([ 3, 2 ])
      expect(failing_rows.first[:group_id]).to eq(worse.id)
    end

    describe "what it deliberately leaves alone" do
      it "gives a young house time before asking about its timezone" do
        create(:group, created_at: now - 2.days, timezone_confirmed_at: nil)

        expect(payload[:attention].count { |row| row[:reason] == "unconfirmed_timezone" }).to eq(1)
      end

      it "gives a draft rota a week before calling it stalled" do
        recent = settled_group(created_at: now - 20.days)
        create(:rota, group: recent, created_at: now - 2.days)

        expect(rows_for(recent)).to be_empty
      end

      it "leaves a house alone once any of its rotas has a roster" do
        running = settled_group(created_at: now - 20.days)
        create(:rota, group: running, created_at: now - 10.days)
        create(:rota, :with_roster, group: running, created_at: now - 10.days)

        expect(rows_for(running)).to be_empty
      end

      it "does not chase a house that has no rotas at all — that is the funnel's job" do
        expect(rows_for(drifting).map { |row| row[:reason] }).to eq(%w[unconfirmed_timezone])
      end

      it "ignores a failed text older than the window" do
        old = settled_group
        text_for(old, status: "failed", created_at: now - 8.days)

        expect(rows_for(old)).to be_empty
      end

      # Someone who has left the house is not someone the house is failing to reach.
      it "ignores an inactive member who opted out" do
        left = settled_group
        create(:member, group: left, active: false, sms_opted_out_at: now - 1.day)

        expect(rows_for(left)).to be_empty
      end
    end
  end

  describe "recent houses and their furthest step" do
    def step_for(group)
      payload[:recent_houses].find { |row| row[:group_id] == group.id }
    end

    it "reports a house that has only been made" do
      group = create(:group, timezone_confirmed_at: nil)

      expect(step_for(group)).to include(furthest_step: "made_house", furthest_step_number: 1)
    end

    it "reports a confirmed timezone" do
      expect(step_for(settled_group)).to include(furthest_step: "confirmed_timezone", furthest_step_number: 2)
    end

    it "reports a first member" do
      group = settled_group
      create(:member, group: group)

      expect(step_for(group)).to include(furthest_step: "added_member", furthest_step_number: 3)
    end

    it "reports a rota only once somebody is on it" do
      drafting = settled_group
      create(:rota, group: drafting)
      create(:member, group: drafting)

      running = settled_group
      create(:rota, :with_roster, group: running)

      expect(step_for(drafting)).to include(furthest_step: "added_member")
      expect(step_for(running)).to include(furthest_step: "started_rota", furthest_step_number: 4)
    end

    it "reports a first delivered reminder" do
      group = settled_group
      text_for(group, status: "delivered")

      expect(step_for(group)).to include(furthest_step: "delivered_text", furthest_step_number: 5)
    end

    # Nobody has been told anything until the text arrives.
    it "does not count a reminder the carrier has not confirmed" do
      group = settled_group
      create(:rota, :with_roster, group: group)
      text_for(group, status: "sent")

      expect(step_for(group)).to include(furthest_step: "started_rota")
    end

    # A magic-link text is somebody logging in, not the product doing its job.
    it "does not count a delivered member login text" do
      group = settled_group
      member = create(:member, group: group)
      SmsMessage.create!(kind: :member_login, member: member, status: :delivered, body: "Your link")

      expect(step_for(group)).to include(furthest_step: "added_member")
    end

    it "reports a first cover" do
      group = settled_group
      text_for(group, kind: "cover_notice", status: "pending")

      expect(step_for(group)).to include(furthest_step: "first_cover", furthest_step_number: 6)
    end

    # Furthest, not latest. A house that is texting reminders has plainly got past "added a member"
    # whether or not anyone ever confirmed its timezone.
    it "reports the highest rung reached even when a lower one was skipped" do
      group = create(:group, timezone_confirmed_at: nil)
      text_for(group, status: "delivered")

      expect(step_for(group)).to include(furthest_step: "delivered_text")
    end

    it "returns the last ten houses made, newest first" do
      groups = 12.times.map { |n| create(:group, created_at: now - n.days) }

      rows = payload[:recent_houses]

      expect(rows.length).to eq(10)
      expect(rows.map { |row| row[:group_id] }).to eq(groups.first(10).map(&:id))
    end

    it "carries the house's identity and timezone state for the page to render" do
      group = create(:group, name: "Alma Road", timezone: "Europe/London", timezone_confirmed_at: nil)

      expect(step_for(group)).to include(
        group_id: group.id, name: "Alma Road", slug: group.slug,
        timezone: "Europe/London", timezone_confirmed: false, created_at: group.created_at
      )
    end
  end

  describe "system health" do
    def job(name) = payload[:system_health][:jobs].find { |row| row[:name] == name }

    it "reports every monitored job, in order, even one that has never run" do
      expect(payload[:system_health][:jobs].map { |row| row[:name] })
        .to eq(%w[reminder_sweep top_up_shift_windows calendar_sync])
    end

    # A job that has never finished once is the loudest thing this tile can say.
    it "reports a null finish for a job with no runs" do
      expect(job("calendar_sync")).to include(last_finished_at: nil, succeeded: nil, error_class: nil)
    end

    it "reads the most recent run of each name" do
      create(:job_run, name: "reminder_sweep", finished_at: now - 3.hours)
      create(:job_run, name: "reminder_sweep", finished_at: now - 1.hour)
      create(:job_run, name: "top_up_shift_windows", finished_at: now - 9.hours)

      expect(job("reminder_sweep")[:last_finished_at]).to eq(now - 1.hour)
      expect(job("top_up_shift_windows")[:last_finished_at]).to eq(now - 9.hours)
    end

    it "surfaces a failing job with the class that explains it" do
      create(:job_run, :failed, name: "calendar_sync", finished_at: now - 1.hour)

      expect(job("calendar_sync")).to include(
        succeeded: false, error_class: "ActiveRecord::StatementInvalid"
      )
    end

    it "counts Solid Queue's failed executions" do
      expect(payload[:system_health][:queue_failed_executions]).to eq(0)
    end

    # The queue lives in its own database, so this is the one read that can fail alone. An operator
    # whose queue database is unreachable needs the rest of this page more than ever.
    it "reports the queue count as unknown rather than failing the whole page" do
      allow(SolidQueue::FailedExecution).to receive(:count)
        .and_raise(ActiveRecord::ConnectionNotEstablished, "queue is away")
      allow(Rails.logger).to receive(:error)

      expect(payload[:system_health][:queue_failed_executions]).to be_nil
      expect(payload[:kpis][:houses_total]).to eq(0)
      expect(Rails.logger).to have_received(:error).with(/failed executions/)
    end
  end

  describe "the spend tile" do
    # Deliberately a null placeholder: the money is https://linear.app/bloombase/issue/BLO-1683.
    it "is present and empty so the page can render its empty state today" do
      expect(payload).to have_key(:spend)
      expect(payload[:spend]).to be_nil
    end
  end

  describe "caching" do
    # The suite runs on a null store, which never caches — so an example about caching has to bring
    # a real one. See config/environments/test.rb.
    let(:store) { ActiveSupport::Cache::MemoryStore.new }

    before { allow(Rails).to receive(:cache).and_return(store) }

    def queries_during
      count = 0
      subscriber = ActiveSupport::Notifications.subscribe("sql.active_record") do |*, payload|
        count += 1 unless payload[:name].in?([ "SCHEMA", "TRANSACTION" ])
      end
      yield
      count
    ensure
      ActiveSupport::Notifications.unsubscribe(subscriber)
    end

    it "answers a second call inside the minute without touching the database" do
      described_class.call

      expect(queries_during { described_class.call }).to eq(0)
    end

    it "hands back the same payload inside the minute" do
      create(:group)
      first = described_class.call
      create(:group)

      expect(described_class.call[:kpis][:houses_total]).to eq(first[:kpis][:houses_total]).and eq(1)
    end

    it "goes back to the database once the minute is up" do
      create(:group)
      described_class.call
      create(:group)

      travel 61.seconds

      expect(described_class.call[:kpis][:houses_total]).to eq(2)
    end

    # Every operator sees the same numbers, so one cached copy serves all of them.
    it "keys the cache on nothing per-user" do
      expect(described_class::CACHE_KEY).to eq("super_admin/overview/v1")

      described_class.call

      expect(store.exist?("super_admin/overview/v1")).to be(true)
    end
  end

  it "stamps the payload with the moment it was built" do
    expect(payload[:generated_at]).to eq(now)
  end

  # Nothing on this page changes anything. The request spec asserts the same thing through the
  # controller; this one holds it at the query object, where a stray `find_or_create_by` would go.
  it "writes nothing" do
    settled_group.tap { |group| text_for(group, status: "delivered") }

    writes = []
    subscriber = ActiveSupport::Notifications.subscribe("sql.active_record") do |*, event|
      writes << event[:sql] if event[:sql].match?(/\A\s*(INSERT|UPDATE|DELETE)\b/i)
    end
    described_class.new.call
    ActiveSupport::Notifications.unsubscribe(subscriber)

    expect(writes).to be_empty
  end
end
