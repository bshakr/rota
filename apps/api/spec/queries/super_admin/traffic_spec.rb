require "rails_helper"

# The traffic dashboard's arithmetic (BLO-1681): a conversion funnel, two figures beside it, and a
# weekly series of what the product actually did.
#
# Every example fixes the clock, because every figure here is either a window measured back from
# "now" or a bucket that starts on a Monday. A suite that drifted with the calendar would pass or
# fail by the day of the week it was run on, which is the kind of flake nobody ever chases down.
RSpec.describe SuperAdmin::Traffic do
  # A Wednesday at noon UTC. The 30-day window back from it opens on Monday 17 August, so the weekly
  # buckets below are exactly Aug 17, 24, 31, Sep 7 and 14 — five of them, across a month boundary.
  let(:now) { Time.utc(2026, 9, 16, 12, 0, 0) }

  around { |example| travel_to(now) { example.run } }

  def result(range: "30d")
    described_class.call(range: range)
  end

  def funnel_step(key, range: "30d")
    result(range: range)[:funnel].find { |step| step[:key] == key }
  end

  def week(starting, payload = result)
    payload[:weeks].find { |row| row[:week_starting] == starting }
  end

  # One text, at a moment, to somebody in this house.
  #
  # `created_at` is set explicitly rather than travelled to: the funnel reads a member's and a
  # house's `created_at` as well as the text's, and an example needs to be able to say that a house
  # is old and its first text is new.
  def text(group, kind: "reminder", status: "delivered", at: now, member: nil, error_code: nil)
    member ||= create(:member, group: group, created_at: at)

    if kind == "member_login"
      create(:sms_message,
        kind: kind, shift: nil, days_before: nil, member: member,
        status: status, error_code: error_code, created_at: at)
    else
      shift = create(:shift, rota: create(:rota, group: group), assigned_member: member)
      create(:sms_message,
        kind: kind, days_before: (kind == "reminder" ? 3 : nil), shift: shift, member: member,
        status: status, error_code: error_code, created_at: at)
    end
  end

  # An admin who signed in, with the house they went on to make.
  def admin_of(group, signed_in_at:)
    user = create(:user, created_at: signed_in_at)
    create(:sign_in, user: user, created_at: signed_in_at)
    create(:group_admin, user: user, group: group, created_at: signed_in_at)
    user
  end

  describe "the window" do
    it "answers for the last thirty days when no range is named" do
      expect(result[:range]).to eq("30d")
      expect(result[:starts_at]).to eq((now - 30.days).iso8601)
      expect(result[:ends_at]).to eq(now.iso8601)
    end

    it "accepts each range the page offers" do
      expect(described_class.call(range: "7d")[:starts_at]).to eq((now - 7.days).iso8601)
      expect(described_class.call(range: "90d")[:starts_at]).to eq((now - 90.days).iso8601)
    end

    it "refuses a range nobody defined rather than quietly answering for another one" do
      expect { described_class.call(range: "6m") }.to raise_error(described_class::UnknownRange, /6m/)
    end
  end

  describe "the funnel" do
    it "says the landing step is not tracked rather than reporting it as zero" do
      step = funnel_step("landing_views")

      expect(step[:step]).to eq(1)
      expect(step[:tracked]).to be(false)
      expect(step[:count]).to be_nil
      expect(step[:note]).to eq("not tracked yet")
      expect(step[:rate_from_previous]).to be_nil
    end

    it "has no rate for the sign-in step, because the step above it has no number" do
      create(:sign_in, created_at: now - 1.day)

      expect(funnel_step("signed_in")[:rate_from_previous]).to be_nil
    end

    it "counts a person who signed in five times in the window once" do
      user = create(:user)
      create(:sign_in, user: user, created_at: now - 2.days)
      create(:sign_in, user: user, created_at: now - 1.day)
      create(:sign_in, created_at: now - 40.days)

      expect(funnel_step("signed_in")[:count]).to eq(1)
    end

    it "counts the houses made inside the window" do
      create(:group, created_at: now - 3.days)
      create(:group, created_at: now - 31.days)

      expect(funnel_step("made_house")[:count]).to eq(1)
    end

    it "counts a timezone confirmed inside the window" do
      create(:group, created_at: now - 3.days, timezone_confirmed_at: now - 2.days)
      create(:group, created_at: now - 3.days, timezone_confirmed_at: nil)
      create(:group, created_at: now - 60.days, timezone_confirmed_at: now - 50.days)

      expect(funnel_step("confirmed_timezone")[:count]).to eq(1)
    end

    it "rates each step against the one before it, to one decimal" do
      3.times { create(:sign_in, user: create(:user), created_at: now - 2.days) }
      create(:group, created_at: now - 1.day)

      expect(funnel_step("made_house")[:rate_from_previous]).to eq(33.3)
    end

    it "reports no rate rather than dividing by an empty step" do
      create(:group, created_at: now - 1.day)

      expect(funnel_step("signed_in")[:count]).to eq(0)
      expect(funnel_step("made_house")[:rate_from_previous]).to be_nil
    end

    it "numbers and orders the eight steps the plan names" do
      expect(result[:funnel].map { |step| step[:key] }).to eq(
        %w[landing_views signed_in made_house confirmed_timezone added_member started_rota delivered_text first_cover]
      )
      expect(result[:funnel].map { |step| step[:step] }).to eq((1..8).to_a)
    end
  end

  # The one semantic decision in this file, asserted rather than left to the reader: steps 3 to 8
  # are a COHORT of first events. "Added a member" means the house's first ever member arrived in
  # the window, not that a house which has had members for a year added another one.
  describe "the funnel's cohort semantics" do
    it "counts the house whose first member arrived in the window, not one that merely added another" do
      established = create(:group, created_at: now - 200.days)
      create(:member, group: established, created_at: now - 100.days)
      create(:member, group: established, created_at: now - 2.days)

      fresh = create(:group, created_at: now - 3.days)
      create(:member, group: fresh, created_at: now - 3.days)

      expect(funnel_step("added_member")[:count]).to eq(1)
    end

    it "counts a rota as started only once somebody is standing on it" do
      group = create(:group, created_at: now - 3.days)
      rota = create(:rota, group: group, created_at: now - 3.days)

      expect(funnel_step("started_rota")[:count]).to eq(0)

      create(:rota_position, rota: rota, member: create(:member, group: group), created_at: now - 2.days)

      expect(funnel_step("started_rota")[:count]).to eq(1)
    end

    it "counts the house whose first roster was filled in the window, not one that added a third housemate" do
      established = create(:group, created_at: now - 200.days)
      rota = create(:rota, group: established)
      create(:rota_position, rota: rota, member: create(:member, group: established), position: 0,
        created_at: now - 150.days)
      create(:rota_position, rota: rota, member: create(:member, group: established), position: 1,
        created_at: now - 1.day)

      expect(funnel_step("started_rota")[:count]).to eq(0)
    end

    it "counts a reminder the carrier confirmed, not one that only left the building" do
      group = create(:group, created_at: now - 3.days)
      text(group, status: "sent", at: now - 2.days)

      expect(funnel_step("delivered_text")[:count]).to eq(0)

      text(group, status: "delivered", at: now - 1.day)

      expect(funnel_step("delivered_text")[:count]).to eq(1)
    end

    it "ignores a cover notice when counting the first delivered reminder" do
      group = create(:group, created_at: now - 3.days)
      text(group, kind: "cover_notice", status: "delivered", at: now - 1.day)

      expect(funnel_step("delivered_text")[:count]).to eq(0)
      expect(funnel_step("first_cover")[:count]).to eq(1)
    end

    it "counts the house whose first cover happened in the window, not one that covers every week" do
      established = create(:group, created_at: now - 200.days)
      text(established, kind: "cover_notice", at: now - 120.days)
      text(established, kind: "cover_notice", at: now - 1.day)

      expect(funnel_step("first_cover")[:count]).to eq(0)
    end

    it "counts any cover notice, whatever became of the text, because the cover still happened" do
      group = create(:group, created_at: now - 3.days)
      text(group, kind: "cover_notice", status: "failed", at: now - 1.day)

      expect(funnel_step("first_cover")[:count]).to eq(1)
    end
  end

  describe "how long it takes a house to send its first text" do
    it "measures from the admin's first sign-in to their house's first delivered reminder" do
      group = create(:group, created_at: now - 10.days)
      user = admin_of(group, signed_in_at: now - 10.days)
      create(:sign_in, user: user, created_at: now - 9.days)
      text(group, at: now - 10.days + 26.hours)

      expect(result[:median_hours_to_first_text]).to eq(26.0)
      expect(result[:median_hours_sample]).to eq(1)
    end

    it "takes the middle of several admins, and the midpoint when there is no middle one" do
      [ 2, 10, 30 ].each do |hours|
        group = create(:group, created_at: now - 20.days)
        admin_of(group, signed_in_at: now - 20.days)
        text(group, at: now - 20.days + hours.hours)
      end

      expect(result[:median_hours_to_first_text]).to eq(10.0)
      expect(result[:median_hours_sample]).to eq(3)

      group = create(:group, created_at: now - 20.days)
      admin_of(group, signed_in_at: now - 20.days)
      text(group, at: now - 20.days + 4.hours)

      expect(result[:median_hours_to_first_text]).to eq(7.0)
      expect(result[:median_hours_sample]).to eq(4)
    end

    it "has no figure at all when no house has sent its first text yet" do
      group = create(:group, created_at: now - 3.days)
      admin_of(group, signed_in_at: now - 3.days)

      expect(result[:median_hours_to_first_text]).to be_nil
      expect(result[:median_hours_sample]).to eq(0)
    end

    it "ignores an admin who joined a house that was already texting" do
      group = create(:group, created_at: now - 25.days)
      text(group, at: now - 20.days)
      admin_of(group, signed_in_at: now - 2.days)

      expect(result[:median_hours_sample]).to eq(0)
    end
  end

  describe "the people who signed in and never made a house" do
    it "counts a user with no house, and not one who has a house" do
      with_house = create(:user)
      create(:sign_in, user: with_house, created_at: now - 2.days)
      create(:group_admin, user: with_house, group: create(:group))

      without_house = create(:user)
      create(:sign_in, user: without_house, created_at: now - 2.days)
      create(:sign_in, user: without_house, created_at: now - 1.day)

      expect(result[:signed_in_without_house]).to eq(1)
    end

    it "only counts someone who signed in inside the window" do
      create(:sign_in, user: create(:user), created_at: now - 40.days)

      expect(result[:signed_in_without_house]).to eq(0)
    end
  end

  describe "the weekly series" do
    it "returns one bucket per week in the window, oldest first, including the empty ones" do
      text(create(:group), at: now - 1.day)

      expect(result[:weeks].map { |row| row[:week_starting] })
        .to eq(%w[2026-08-17 2026-08-24 2026-08-31 2026-09-07 2026-09-14])
    end

    it "buckets on Monday 00:00 UTC" do
      group = create(:group)
      text(group, at: Time.utc(2026, 9, 13, 23, 59, 59))
      text(group, at: Time.utc(2026, 9, 14, 0, 0, 0))

      expect(week("2026-09-07")[:texts_sent]).to eq(1)
      expect(week("2026-09-14")[:texts_sent]).to eq(1)
    end

    it "zero-fills a week nothing happened in rather than leaving a hole in the chart" do
      quiet = week("2026-08-24")

      expect(quiet[:texts_sent]).to eq(0)
      expect(quiet[:texts_by_kind]).to eq({ reminder: 0, cover_notice: 0, member_login: 0 })
      expect(quiet[:covers]).to eq(0)
      expect(quiet[:active_houses]).to eq(0)
      expect(quiet[:active_admins]).to eq(0)
      expect(quiet[:members_seen]).to eq(0)
      expect(quiet[:new_houses]).to eq(0)
      expect(quiet[:delivery_rate]).to be_nil
    end

    it "splits the texts by kind, with every kind present so the stack keeps its shape" do
      group = create(:group)
      text(group, kind: "reminder", at: now - 1.day)
      text(group, kind: "reminder", at: now - 1.day)
      text(group, kind: "cover_notice", at: now - 1.day)
      text(group, kind: "member_login", at: now - 1.day)

      this_week = week("2026-09-14")

      expect(this_week[:texts_sent]).to eq(4)
      expect(this_week[:texts_by_kind]).to eq({ reminder: 2, cover_notice: 1, member_login: 1 })
      expect(this_week[:covers]).to eq(1)
    end

    it "counts new houses in the week they were made" do
      create(:group, created_at: Time.utc(2026, 9, 1, 9, 0))
      create(:group, created_at: Time.utc(2026, 9, 15, 9, 0))

      expect(week("2026-08-31")[:new_houses]).to eq(1)
      expect(week("2026-09-14")[:new_houses]).to eq(1)
    end

    it "counts the members who opened their link in the week they opened it" do
      group = create(:group)
      create(:member, group: group, last_seen_at: Time.utc(2026, 9, 15, 8, 0))
      create(:member, group: group, last_seen_at: Time.utc(2026, 9, 15, 9, 0))
      create(:member, group: group, last_seen_at: nil)

      expect(week("2026-09-14")[:members_seen]).to eq(2)
    end
  end

  describe "active houses" do
    it "counts a house in a week a text actually reached it" do
      group = create(:group)
      text(group, status: "delivered", at: now - 1.day)
      text(group, status: "delivered", at: now - 1.day)

      expect(week("2026-09-14")[:active_houses]).to eq(1)
    end

    it "does not count a house whose texts only ever left the building" do
      text(create(:group), status: "sent", at: now - 1.day)
      text(create(:group), status: "failed", at: now - 1.day)

      expect(week("2026-09-14")[:active_houses]).to eq(0)
    end

    it "counts each house separately, and only in the weeks it heard from" do
      first = create(:group)
      second = create(:group)
      text(first, at: now - 1.day)
      text(second, at: now - 1.day)
      text(first, at: Time.utc(2026, 9, 1, 9, 0))

      expect(week("2026-09-14")[:active_houses]).to eq(2)
      expect(week("2026-08-31")[:active_houses]).to eq(1)
    end
  end

  describe "active admins" do
    it "counts an admin once in a week they both signed in and were seen" do
      user = create(:user, last_seen_at: Time.utc(2026, 9, 15, 10, 0))
      create(:sign_in, user: user, created_at: Time.utc(2026, 9, 14, 10, 0))

      expect(week("2026-09-14")[:active_admins]).to eq(1)
    end

    it "counts an admin who only signed in, and one who was only seen" do
      create(:sign_in, user: create(:user), created_at: Time.utc(2026, 9, 15, 10, 0))
      create(:user, last_seen_at: Time.utc(2026, 9, 15, 11, 0))

      expect(week("2026-09-14")[:active_admins]).to eq(2)
    end

    it "counts the same admin in each week they signed in" do
      user = create(:user, last_seen_at: nil)
      create(:sign_in, user: user, created_at: Time.utc(2026, 9, 1, 10, 0))
      create(:sign_in, user: user, created_at: Time.utc(2026, 9, 15, 10, 0))

      expect(week("2026-08-31")[:active_admins]).to eq(1)
      expect(week("2026-09-14")[:active_admins]).to eq(1)
    end
  end

  describe "the delivery rate" do
    it "rates delivered against everything that settled, to one decimal" do
      group = create(:group)
      2.times { text(group, status: "delivered", at: now - 1.day) }
      text(group, status: "failed", at: now - 1.day)
      text(group, status: "pending", at: now - 1.day)

      this_week = week("2026-09-14")

      expect(this_week[:texts_delivered]).to eq(2)
      expect(this_week[:texts_failed]).to eq(1)
      expect(this_week[:texts_settled]).to eq(3)
      expect(this_week[:delivery_rate]).to eq(66.7)
    end

    it "has no rate for a week where nothing has settled yet" do
      group = create(:group)
      text(group, status: "pending", at: now - 1.day)
      text(group, status: "sent", at: now - 1.day)

      expect(week("2026-09-14")[:texts_sent]).to eq(2)
      expect(week("2026-09-14")[:delivery_rate]).to be_nil
    end
  end

  describe "failures by error code" do
    it "lists the five commonest codes over the whole range, worst first, with each one's share" do
      group = create(:group)
      { "30006" => 5, "21610" => 4, "30003" => 3, "not_contactable" => 2, "30005" => 1, "21614" => 1 }
        .each do |code, count|
          count.times { text(group, status: "failed", error_code: code, at: now - 2.days) }
        end

      failures = result[:failures]

      expect(failures[:total]).to eq(16)
      expect(failures[:top].map { |row| row[:error_code] }).to eq(%w[30006 21610 30003 not_contactable 21614])
      expect(failures[:top].first).to eq({ error_code: "30006", count: 5, share: 31.3 })
    end

    it "counts a failure nobody gave a code apart, so the shares can be read honestly" do
      group = create(:group)
      text(group, status: "failed", error_code: "30006", at: now - 2.days)
      text(group, status: "failed", error_code: nil, at: now - 2.days)

      expect(result[:failures][:total]).to eq(2)
      expect(result[:failures][:uncoded]).to eq(1)
      expect(result[:failures][:top]).to eq([ { error_code: "30006", count: 1, share: 50.0 } ])
    end

    it "counts only the failures inside the window" do
      group = create(:group)
      text(group, status: "failed", error_code: "30006", at: now - 40.days)

      expect(result[:failures][:total]).to eq(0)
      expect(result[:failures][:top]).to eq([])
    end
  end

  # The plan asks for a DST test. The buckets are UTC, so a clocks change cannot move an edge — and
  # that is precisely the claim worth proving, because the app's houses all keep local time and a
  # reader could reasonably assume these buckets do too.
  describe "weekly buckets across a clocks change" do
    context "when Europe/London goes back to GMT" do
      # The Wednesday after the change, so the window covers both sides of it.
      let(:now) { Time.utc(2026, 11, 4, 12, 0) }

      it "keeps Monday 00:00 UTC as the edge" do
        group = create(:group)
        # 01:30 BST and 01:30 GMT: the same wall clock in London, an hour apart in UTC, both on the
        # Sunday of the change.
        text(group, at: Time.utc(2026, 10, 25, 0, 30))
        text(group, at: Time.utc(2026, 10, 25, 1, 30))
        text(group, at: Time.utc(2026, 10, 26, 0, 30))

        starts = result[:weeks].map { |row| Date.parse(row[:week_starting]) }

        # No 167- or 169-hour week: every edge is exactly seven days from the last.
        expect(starts.each_cons(2).map { |earlier, later| (later - earlier).to_i }.uniq).to eq([ 7 ])
        expect(week("2026-10-19")[:texts_sent]).to eq(2)
        expect(week("2026-10-26")[:texts_sent]).to eq(1)
      end
    end

    context "when Europe/London springs forward into BST" do
      let(:now) { Time.utc(2026, 4, 8, 12, 0) }

      it "keeps the same edge" do
        group = create(:group)
        text(group, at: Time.utc(2026, 3, 29, 0, 30))
        text(group, at: Time.utc(2026, 3, 29, 1, 30))
        text(group, at: Time.utc(2026, 3, 30, 0, 30))

        starts = result[:weeks].map { |row| Date.parse(row[:week_starting]) }

        expect(starts.each_cons(2).map { |earlier, later| (later - earlier).to_i }.uniq).to eq([ 7 ])
        expect(week("2026-03-23")[:texts_sent]).to eq(2)
        expect(week("2026-03-30")[:texts_sent]).to eq(1)
      end
    end
  end

  describe "the number of questions it asks the database" do
    def queries_during
      statements = []
      subscriber = ActiveSupport::Notifications.subscribe("sql.active_record") do |*, payload|
        next if payload[:name].in?([ "SCHEMA", "TRANSACTION" ])
        next if payload[:sql].match?(/\A\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i)

        statements << payload[:sql]
      end
      yield
      statements
    ensure
      ActiveSupport::Notifications.unsubscribe(subscriber)
    end

    def house_with_traffic(index)
      group = create(:group, created_at: now - 20.days)
      admin_of(group, signed_in_at: now - 20.days)
      text(group, at: now - (index % 10).days)
      text(group, kind: "cover_notice", at: now - (index % 10).days)
    end

    it "asks the same number of questions for twenty houses as for two" do
      2.times { |index| house_with_traffic(index) }
      described_class.call # warm the connection's schema and prepared statement caches

      two_houses = queries_during { described_class.call }

      18.times { |index| house_with_traffic(index + 2) }

      twenty_houses = queries_during { described_class.call }

      expect(twenty_houses.length).to eq(two_houses.length),
        "#{two_houses.length} queries for two houses, #{twenty_houses.length} for twenty"
    end
  end

  describe "caching" do
    let(:store) { ActiveSupport::Cache::MemoryStore.new }

    before { allow(Rails).to receive(:cache).and_return(store) }

    it "serves the same answer inside the minute rather than asking the database again" do
      group = create(:group)
      text(group, at: now - 1.day)

      first = described_class.cached(range: "30d")
      text(group, at: now - 1.day)

      expect(described_class.cached(range: "30d")).to eq(first)
    end

    it "keys on the range, so a different window is a different answer" do
      text(create(:group), at: now - 40.days)

      expect(described_class.cached(range: "30d")[:weeks].sum { |row| row[:texts_sent] }).to eq(0)
      expect(described_class.cached(range: "90d")[:weeks].sum { |row| row[:texts_sent] }).to eq(1)
    end

    it "refuses an unknown range before it reaches the cache" do
      expect { described_class.cached(range: "6m") }.to raise_error(described_class::UnknownRange)
    end

    # Solid Cache outlives a deploy, so a payload whose shape has changed would be served to the new
    # page for a minute if the key were not versioned. Asserted rather than trusted, because the
    # suffix reads as clutter to anyone who does not know what it is for.
    it "versions the key, so a deploy that changes the payload cannot serve the old shape" do
      expect(described_class.cache_key("30d")).to eq("super_admin/traffic/v1/30d")
    end

    it "names nobody in the key: every operator sees the same numbers" do
      expect(described_class.cache_key("7d")).not_to include("user")
    end
  end
end
