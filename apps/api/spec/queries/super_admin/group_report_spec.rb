require "rails_helper"

# One house, as the operator reads it. Every figure here is either a window with an edge that can be
# got wrong (the fortnight of shifts, the twelve weeks of texts) or a count over a table the house
# itself never sees (sign-ins, last seen), so the clock is pinned in every example and the edges are
# tested from both sides.
RSpec.describe SuperAdmin::GroupReport do
  # A Wednesday, so the current week's Monday is 2026-09-14 00:00 UTC and there is room either side
  # of it. A `let` rather than a constant: a constant assigned in this block would land on Object.
  let(:now) { Time.utc(2026, 9, 16, 12, 0, 0) }
  let(:group) { create(:group, name: "Alma Road") }

  subject(:report) { described_class.call(group, now: now) }

  around { |example| travel_to(now) { example.run } }

  # A shift on a given date. `due_on` is unique per rota and a shift may only name members of its
  # rota's own group, so both default to this house's and move together when they don't.
  def shift_on(date, member: house_member, rota: nil, covering: nil)
    rota ||= member.group == group ? house_rota : rota_for(member.group)

    create(:shift, rota: rota, assigned_member: member, covering_member: covering, due_on: date)
  end

  # One text in a house's log at a given instant. `created_at` is written straight onto the row
  # because it, not `sent_at`, is what every window in this file buckets on.
  def text_at(moment, status: "sent", kind: "reminder", member: house_member)
    trait = kind == "cover_notice" ? [ :cover_notice ] : []
    shift = shift_on(next_shift_date, member: member)
    message = create(:sms_message, *trait, shift: shift, member: member, status: status)

    message.update_columns(created_at: moment, updated_at: moment)
    message
  end

  # Far enough out that these bookkeeping shifts never land inside the fortnight the report shows.
  def next_shift_date
    @shift_date = (@shift_date || Date.new(2027, 1, 1)) + 1
  end

  # One rota per house, reused, so a spec about texts never accidentally becomes a spec about how
  # many rotas got created along the way.
  def rota_for(other)
    @rotas ||= {}
    @rotas[other.id] ||= create(:rota, group: other)
  end

  let(:house_rota) { create(:rota, group: group, name: "Bins") }
  let(:house_member) { create(:member, group: group, name: "Alice") }

  describe "upcoming shifts" do
    # 2026-09-16 12:00 UTC is still 2026-09-16 in London, so the window is 16 Sept to 29 Sept.
    let(:group) { create(:group, timezone: "Europe/London") }

    def due_dates = report.fetch(:upcoming_shifts).map { |row| row.fetch(:due_on) }

    it "starts today, because a turn due this evening is the most actionable row on the page" do
      shift_on(Date.new(2026, 9, 16))

      expect(due_dates).to eq([ Date.new(2026, 9, 16) ])
    end

    it "leaves yesterday's turn out" do
      shift_on(Date.new(2026, 9, 15))

      expect(due_dates).to be_empty
    end

    # Fourteen days means today plus thirteen: 16 Sept through 29 Sept.
    it "reaches the fourteenth day and stops" do
      shift_on(Date.new(2026, 9, 29))
      shift_on(Date.new(2026, 9, 30))

      expect(due_dates).to eq([ Date.new(2026, 9, 29) ])
    end

    it "orders by date, then by rota, then by id, so the list never reshuffles under the reader" do
      zed = create(:rota, group: group, name: "Zed")
      shift_on(Date.new(2026, 9, 20), rota: zed)
      shift_on(Date.new(2026, 9, 20))
      shift_on(Date.new(2026, 9, 18))

      expect(report.fetch(:upcoming_shifts).map { |row| row.values_at(:due_on, :rota_name) }).to eq([
        [ Date.new(2026, 9, 18), "Bins" ],
        [ Date.new(2026, 9, 20), "Bins" ],
        [ Date.new(2026, 9, 20), "Zed" ]
      ])
    end

    it "names the rota, the date and who is on the hook" do
      shift = shift_on(Date.new(2026, 9, 18))

      expect(report.fetch(:upcoming_shifts)).to eq([ {
        id: shift.id, rota_id: house_rota.id, rota_name: "Bins", due_on: Date.new(2026, 9, 18),
        covered: false,
        assigned_member: { id: house_member.id, name: "Alice" },
        covering_member: nil,
        responsible_member: { id: house_member.id, name: "Alice" }
      } ])
    end

    # A cover is the product's one real engagement signal, and the operator's question is always
    # "who is covering for whom" — both names, not the resolved one.
    it "marks a cover and names both people" do
      bob = create(:member, group: group, name: "Bob")
      shift_on(Date.new(2026, 9, 18), covering: bob)

      expect(report.fetch(:upcoming_shifts).first).to include(
        covered: true,
        assigned_member: { id: house_member.id, name: "Alice" },
        covering_member: { id: bob.id, name: "Bob" },
        responsible_member: { id: bob.id, name: "Bob" }
      )
    end

    it "carries no other house's turns" do
      shift_on(Date.new(2026, 9, 18), member: create(:member, group: create(:group)))

      expect(due_dates).to be_empty
    end

    # The window is cut from Group#today, never from Date.current, which is UTC here. At this
    # instant it is already tomorrow in Auckland, so a UTC window would show the house a day of its
    # own rota that has already been and gone, and hide the last day of the fortnight.
    describe "in a house whose calendar day is not the server's" do
      let(:now) { Time.utc(2026, 9, 13, 23, 30, 0) }

      # 2026-09-13 23:30 UTC is 2026-09-14 11:30 in Auckland (NZST, UTC+12 — NZDT does not begin
      # until the 27th), so this house's window is 14 Sept to 27 Sept.
      let(:group) { create(:group, timezone: "Pacific/Auckland") }

      it "leaves out the day that is still today in UTC but yesterday in the house" do
        shift_on(Date.new(2026, 9, 13))

        expect(due_dates).to be_empty
      end

      it "reaches the fourteenth of the house's own days, not the server's" do
        shift_on(Date.new(2026, 9, 27))
        shift_on(Date.new(2026, 9, 28))

        expect(due_dates).to eq([ Date.new(2026, 9, 27) ])
      end
    end

    # And the mirror image, a house behind UTC rather than ahead of it: it is still yesterday in
    # Honolulu, and the turn due there today would be missing from a UTC window.
    describe "in a house whose calendar day is behind the server's" do
      let(:now) { Time.utc(2026, 9, 14, 0, 30, 0) }
      let(:group) { create(:group, timezone: "Pacific/Honolulu") }

      it "includes the turn that is today in the house and yesterday in UTC" do
        shift_on(Date.new(2026, 9, 13))

        expect(due_dates).to eq([ Date.new(2026, 9, 13) ])
      end
    end
  end

  describe "the weekly series" do
    def weekly = report.fetch(:weekly)

    it "is twelve weeks of Mondays, oldest first" do
      starts = weekly.map { |row| row.fetch(:week_start) }

      expect(starts.length).to eq(12)
      expect(starts.first).to eq(Date.new(2026, 6, 29))
      expect(starts.last).to eq(Date.new(2026, 9, 14))
      expect(starts.map(&:monday?)).to all(be(true))
      expect(starts.each_cons(2).map { |a, b| b - a }.uniq).to eq([ 7 ])
    end

    it "zero-fills a week nothing happened in, so a quiet house draws a flat line" do
      text_at(Time.utc(2026, 9, 15, 9, 0, 0))

      expect(weekly.map { |row| row.fetch(:texts) }).to eq([ 0 ] * 11 + [ 1 ])
      expect(weekly.map { |row| row.fetch(:covers) }).to all(eq(0))
    end

    it "puts each text in the week its Monday starts" do
      text_at(Time.utc(2026, 9, 14, 0, 0, 0))
      text_at(Time.utc(2026, 9, 20, 23, 59, 59))
      text_at(Time.utc(2026, 9, 13, 23, 59, 59))

      by_week = weekly.to_h { |row| [ row.fetch(:week_start), row.fetch(:texts) ] }

      expect(by_week.fetch(Date.new(2026, 9, 14))).to eq(2)
      expect(by_week.fetch(Date.new(2026, 9, 7))).to eq(1)
    end

    it "drops a text older than the twelve weeks rather than folding it into the first bucket" do
      text_at(Time.utc(2026, 6, 28, 12, 0, 0))

      expect(weekly.map { |row| row.fetch(:texts) }).to all(eq(0))
    end

    # "Texts" means what the list and this page's own header mean by it (GroupStats): Twilio was
    # asked and either took it or refused it. A row the queue never finished with is not a text
    # that went out, and drawing it as one would hide the morning forty reminders stranded.
    it "counts only the texts the house actually attempted" do
      %w[sent delivered failed].each { |status| text_at(now - 1.day, status: status) }
      %w[pending sending].each { |status| text_at(now - 1.day, status: status) }

      expect(weekly.last.fetch(:texts)).to eq(3)
    end

    # A cover happened whatever became of the text about it — the swap is the event, the notice is
    # only its record. This is the same rule SuperAdmin::Overview counts `covers_this_week` by.
    it "counts a cover in every state the notice about it can be in" do
      %w[pending sent delivered failed].each { |status| text_at(now - 1.day, kind: "cover_notice", status: status) }

      expect(weekly.last.fetch(:covers)).to eq(4)
    end

    it "counts no other house's texts" do
      other = create(:group)
      other_member = create(:member, group: other)
      text_at(now - 1.day, member: other_member)

      expect(weekly.map { |row| row.fetch(:texts) }).to all(eq(0))
    end

    # The buckets are calendar arithmetic in UTC, so a month ending mid-week is not an edge at all.
    # It is worth a spec because it is the first thing a reader assumes is broken.
    describe "across a month boundary" do
      let(:now) { Time.utc(2026, 10, 7, 12, 0, 0) }

      it "keeps the week of 28 September whole, on both sides of the first of October" do
        text_at(Time.utc(2026, 9, 30, 23, 0, 0))
        text_at(Time.utc(2026, 10, 1, 1, 0, 0))

        by_week = weekly.to_h { |row| [ row.fetch(:week_start), row.fetch(:texts) ] }

        expect(by_week.fetch(Date.new(2026, 9, 28))).to eq(2)
        expect(by_week.fetch(Date.new(2026, 10, 5))).to eq(0)
      end
    end

    # The clocks go back in the UK at 02:00 BST on Sunday 25 October 2026. A series bucketed in a
    # house's own zone would have a 169-hour week there; these are UTC buckets, so there is no such
    # week and this spec is the proof rather than the hope.
    describe "across a change of the clocks" do
      let(:now) { Time.utc(2026, 11, 4, 12, 0, 0) }
      let(:group) { create(:group, timezone: "Europe/London") }

      it "keeps every week exactly seven days wide" do
        starts = weekly.map { |row| row.fetch(:week_start) }

        expect(starts).to include(Date.new(2026, 10, 19), Date.new(2026, 10, 26))
        expect(starts.each_cons(2).map { |a, b| b - a }.uniq).to eq([ 7 ])
      end

      it "cuts the week at Monday 00:00 UTC, not at the house's local midnight" do
        text_at(Time.utc(2026, 10, 25, 23, 30, 0))
        text_at(Time.utc(2026, 10, 26, 0, 30, 0))

        by_week = weekly.to_h { |row| [ row.fetch(:week_start), row.fetch(:texts) ] }

        expect(by_week.fetch(Date.new(2026, 10, 19))).to eq(1)
        expect(by_week.fetch(Date.new(2026, 10, 26))).to eq(1)
      end

      # The same instant, two houses, one of them thirteen hours ahead: the operator's week is the
      # operator's week, and a group page cannot disagree with the overview about which one it is.
      it "puts the same instant in the same bucket whatever the house's timezone is" do
        far = create(:group, timezone: "Pacific/Auckland")
        far_member = create(:member, group: far)

        text_at(Time.utc(2026, 10, 26, 0, 30, 0))
        text_at(Time.utc(2026, 10, 26, 0, 30, 0), member: far_member)

        here = weekly.to_h { |row| [ row.fetch(:week_start), row.fetch(:texts) ] }
        there = described_class.call(far, now: now).fetch(:weekly)
          .to_h { |row| [ row.fetch(:week_start), row.fetch(:texts) ] }

        expect(here.fetch(Date.new(2026, 10, 26))).to eq(1)
        expect(there.fetch(Date.new(2026, 10, 26))).to eq(1)
      end
    end
  end

  describe "admins" do
    let(:user) { create(:user, name: "Ada", email: "ada@example.com", workos_user_id: "user_01ADA") }

    def admin_row = report.fetch(:admins).first

    it "carries the identity the operator's serializer decides, plus what it cannot know" do
      membership = create(:group_admin, group: group, user: user, role: "owner")
      user.update_column(:last_seen_at, now - 2.hours)

      expect(admin_row).to eq(
        id: membership.id, user_id: user.id, name: "Ada", email: "ada@example.com",
        workos_user_id: "user_01ADA", role: "owner",
        last_seen_at: now - 2.hours, sign_in_count: 0, sign_in_count_30d: 0
      )
    end

    # The placeholder rule has one owner, SuperAdmin::AdminSerializer, and this report goes through
    # it rather than round it — an address at .invalid looks deliverable and is not.
    it "shows no email where the address is the JIT placeholder" do
      placeholder = create(:user, email: User.placeholder_email("user_01NONE"), workos_user_id: "user_01NONE")
      create(:group_admin, group: group, user: placeholder)

      expect(admin_row.fetch(:email)).to be_nil
    end

    it "counts every sign-in ever, and the ones inside thirty days" do
      create(:group_admin, group: group, user: user)
      create(:sign_in, user: user, created_at: now - 2.days)
      create(:sign_in, user: user, created_at: now - 29.days)
      create(:sign_in, user: user, created_at: now - 31.days)

      expect(admin_row).to include(sign_in_count: 3, sign_in_count_30d: 2)
    end

    # A sign-in with no organization is the funnel step the table was added for — somebody signed in
    # before they had a house. Filtering by organization would drop exactly those rows.
    it "counts a sign-in that named no house" do
      create(:group_admin, group: group, user: user)
      create(:sign_in, :without_organization, user: user, created_at: now - 1.day)

      expect(admin_row).to include(sign_in_count: 1, sign_in_count_30d: 1)
    end

    it "counts nobody else's sign-ins" do
      create(:group_admin, group: group, user: user)
      create(:sign_in, user: create(:user), created_at: now - 1.day)

      expect(admin_row).to include(sign_in_count: 0)
    end

    it "names no admin of another house" do
      create(:group_admin, group: create(:group), user: user)

      expect(report.fetch(:admins)).to be_empty
    end
  end

  describe "members" do
    it "carries the operator's member row plus when they last opened their link" do
      member = create(:member, group: group, name: "Alice", phone_e164: "+447400123456")
      member.update_column(:last_seen_at, now - 3.days)
      rota = create(:rota, group: group, name: "Bins")
      create(:rota_position, rota: rota, member: member, position: 0)

      expect(report.fetch(:members)).to eq([ {
        id: member.id, name: "Alice", phone_e164: "+447400123456", status: "active",
        sms_opted_out_at: nil, rotas: [ { id: rota.id, name: "Bins" } ],
        last_seen_at: now - 3.days
      } ])
    end

    it "says nothing rather than guessing for a member who has never opened their link" do
      create(:member, group: group)

      expect(report.fetch(:members).first.fetch(:last_seen_at)).to be_nil
    end

    it "lists everyone, in name order, whatever state they are in" do
      create(:member, group: group, name: "Cleared Out", active: false)
      create(:member, group: group, name: "Active One")
      create(:member, :opted_out, group: group, name: "Bowed Out")

      expect(report.fetch(:members).map { |row| row.values_at(:name, :status) }).to eq([
        [ "Active One", "active" ], [ "Bowed Out", "opted_out" ], [ "Cleared Out", "removed" ]
      ])
    end

    it "never carries an access token" do
      create(:member, group: group)

      expect(report.fetch(:members).first.keys).not_to include(:access_token)
    end
  end

  describe "warnings input" do
    it "is the house's own four payloads, keyed as collectDashboardWarnings takes them" do
      expect(report.fetch(:warnings_input).keys).to eq(%i[group rotas members failed_sms])
    end

    # The house's dashboard fetches its failures with `limit: 100`. A house that had a very bad week
    # must not ship its whole history inside a warning input that is only ever counted.
    it "caps the failures at what the house's own dashboard asks for" do
      member = create(:member, group: group)
      rota = create(:rota, group: group)
      (SuperAdmin::WarningsInput::FAILED_SMS_LIMIT + 2).times do |index|
        shift = create(:shift, rota: rota, assigned_member: member, due_on: Date.new(2027, 3, 1) + index)
        create(:sms_message, :failed, shift: shift, member: member)
      end

      expect(report.dig(:warnings_input, :failed_sms).length).to eq(SuperAdmin::WarningsInput::FAILED_SMS_LIMIT)
    end

    it "carries only the failures, and only this house's" do
      member = create(:member, group: group)
      failed = create(:sms_message, :failed, shift: shift_on(Date.new(2027, 2, 1), member: member), member: member)
      create(:sms_message, :sent, shift: shift_on(Date.new(2027, 2, 2), member: member), member: member)

      other = create(:member, group: create(:group))
      create(:sms_message, :failed, shift: create(:shift, rota: create(:rota, group: other.group),
        assigned_member: other), member: other)

      expect(report.dig(:warnings_input, :failed_sms).map { |row| row.fetch(:id) }).to eq([ failed.id ])
    end
  end

  # https://linear.app/bloombase/issue/BLO-1684 fills this in from SuperAdmin::Spend once
  # https://linear.app/bloombase/issue/BLO-1683 lands it. Null rather than absent so the page can
  # render the tile's empty state today and gain the numbers without a shape change.
  it "leaves spend as a null placeholder" do
    expect(report).to include(spend: nil)
  end

  it "writes nothing" do
    create(:member, group: group)
    create(:group_admin, group: group)

    expect(sql_writes_during { described_class.call(group, now: now) }).to be_empty
  end

  # The only assertion about query counts worth making: not an upper bound, which drifts upward
  # every time somebody adds a legitimate query, but that the count does not grow with the number
  # of rows. This report has more ways to get that wrong than anything else in the namespace —
  # members and the rotas they sit on, a fortnight of shifts with two members each, admins with
  # two sign-in counts apiece, twelve weeks of texts — and every one of them is a grouped or
  # preloaded read for exactly this reason.
  it "costs the same number of queries for a big house as for a small one" do
    small = populate(create(:group), members: 2, rotas: 1, weeks: 1)
    small_queries = sql_selects_during { described_class.call(small, now: now) }

    big = populate(create(:group), members: 8, rotas: 3, weeks: 4)
    big_queries = sql_selects_during { described_class.call(big, now: now) }

    payload = described_class.call(big, now: now)
    expect(payload.fetch(:members).length).to eq(8)
    expect(payload.fetch(:upcoming_shifts).length).to eq(24)
    expect(big_queries.size).to eq(small_queries.size)
  end

  # A house with people, rotas, admins, shifts inside the fortnight and texts across several weeks
  # — every list the report builds, at whatever size the caller asks for.
  def populate(house, members:, rotas:, weeks:)
    people = create_list(:member, members, group: house)
    2.times { create(:group_admin, group: house, user: create(:user)) }

    rotas.times do |index|
      rota = create(:rota, group: house, name: "Rota #{index}")
      people.each_with_index { |member, position| create(:rota_position, rota: rota, member: member, position: position) }

      people.each_with_index do |member, day|
        shift = create(:shift, rota: rota, assigned_member: member,
          covering_member: people[(day + 1) % people.length], due_on: house.today + day)

        weeks.times do |week|
          message = create(:sms_message, :sent, shift: shift, member: member, days_before: week)
          moment = now - week.weeks
          message.update_columns(created_at: moment, updated_at: moment)
        end
      end
    end

    house
  end
end
