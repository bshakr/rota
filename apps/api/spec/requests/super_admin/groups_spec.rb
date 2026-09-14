require "rails_helper"

# The groups list: every house in the database, one row each, with the counts that say whether it
# is alive. The allowlist boundary in front of it is spec/requests/super_admin/authorization_spec.rb,
# which walks these routes automatically; what is under test here is the list itself.
RSpec.describe "GET /api/super_admin/groups" do
  let(:operator) { "user_01OPERATOR" }

  before { allowlist_super_admins(operator) }

  def headers = workos_headers(sub: operator, org_id: nil)

  def list(params = {})
    get "/api/super_admin/groups", params: params, headers: headers
    expect(response).to have_http_status(:ok)
    response.parsed_body.fetch("groups")
  end

  def names(params = {}) = list(params).map { |row| row.fetch("name") }

  it "lists every house, not the caller's own" do
    create(:group, name: "Alma Road")
    create(:group, name: "Bell Street")

    expect(names).to eq([ "Alma Road", "Bell Street" ])
  end

  it "writes nothing: reading across every house provisions nobody" do
    create(:group)

    writes = sql_writes_during { get "/api/super_admin/groups", headers: headers }

    expect(response).to have_http_status(:ok)
    expect(writes).to be_empty
  end

  describe "the counts on a row" do
    let(:group) { create(:group, name: "Alma Road") }

    before do
      create_list(:group_admin, 2, group: group)
      members = create_list(:member, 3, group: group)
      create(:member, :inactive, group: group)

      rota = create(:rota, group: group)
      create(:rota_position, rota: rota, member: members.first, position: 0)
      paused = create(:rota, :inactive, group: group)  # somebody on it, switched off: paused
      create(:rota_position, rota: paused, member: members.second, position: 0)
      create(:rota, group: group)                      # nobody on it: a draft
      create(:rota, :inactive, group: group)           # also nobody on it: also a draft

      text_in(group, rota: rota, member: members.first, at: 2.days.ago)
      text_in(group, rota: rota, member: members.second, status: "failed", at: 3.days.ago)
      text_in(group, rota: rota, member: members.third, status: "pending", at: 4.days.ago)
      text_in(group, rota: rota, member: members.third, at: 20.days.ago)
    end

    it "carries the operator-only columns the house never sees" do
      group.update!(notes: "Trial house for the school run", suspended_at: nil)

      expect(list.first).to include("notes" => "Trial house for the school run", "suspended_at" => nil)
    end

    it "says when a paused house was paused" do
      group.update!(suspended_at: Time.utc(2026, 9, 1, 12))

      expect(Time.zone.parse(list.first.fetch("suspended_at"))).to eq(Time.utc(2026, 9, 1, 12))
    end

    it "counts admins, active members and rotas by whether anyone is on them" do
      expect(list.first).to include(
        "name" => "Alma Road",
        "slug" => group.slug,
        "timezone" => "Europe/London",
        "timezone_confirmed" => false,
        "admins_count" => 2,
        "active_members_count" => 3,
        "running_rotas_count" => 1,
        "paused_rotas_count" => 1,
        "draft_rotas_count" => 2
      )
    end

    # A text nobody tried to send is not a text. The sweep claims a row as `pending` and SendSmsJob
    # moves it on; a row still sitting there is a stranded send, and counting it as one that went
    # out would read as healthy traffic on exactly the morning the queue stopped.
    it "counts the last seven days of texts by whether they were actually attempted" do
      expect(list.first).to include(
        "texts_last_7_days" => 2,
        "failed_texts_last_7_days" => 1,
        "unsent_texts_last_7_days" => 1
      )
    end

    it "counts one of every status the right way round" do
      other = create(:group, name: "Bevery Status")
      rota = create(:rota, group: other)
      member = create(:member, group: other)
      SmsMessage::STATUSES.each_value { |status| text_in(other, rota: rota, member: member, status: status, at: 1.day.ago) }

      row = list.find { |candidate| candidate.fetch("id") == other.id }

      expect(row).to include(
        "texts_last_7_days" => 3,       # sent, delivered, failed
        "unsent_texts_last_7_days" => 2, # pending, sending
        "failed_texts_last_7_days" => 1
      )
    end

    it "reports the latest text as the last thing that happened in the house" do
      expect(Time.zone.parse(list.first.fetch("last_activity_at"))).to be_within(1.second).of(2.days.ago)
    end

    it "answers zeroes for a house that has done nothing at all" do
      quiet_house = create(:group, name: "Zed House")

      row = list.find { |candidate| candidate.fetch("id") == quiet_house.id }

      expect(row).to include(
        "admins_count" => 0, "active_members_count" => 0, "running_rotas_count" => 0,
        "paused_rotas_count" => 0, "draft_rotas_count" => 0, "texts_last_7_days" => 0,
        "unsent_texts_last_7_days" => 0, "failed_texts_last_7_days" => 0, "last_activity_at" => nil
      )
    end
  end

  # "When did anything last happen here" is the latest of three things, not one: the last text, the
  # last time an admin was seen, and the last time a housemate opened their personal link. The first
  # on its own is misleading in both directions — a house whose admins log in weekly but whose rotas
  # are all drafts has sent nothing and is very much not dead.
  describe "last activity" do
    def last_activity_of(group)
      value = list.find { |row| row.fetch("id") == group.id }.fetch("last_activity_at")
      value && Time.zone.parse(value)
    end

    it "counts an admin being seen" do
      group = create(:group)
      create(:group_admin, group: group, user: create(:user, last_seen_at: 2.days.ago))

      expect(last_activity_of(group)).to be_within(1.second).of(2.days.ago)
    end

    it "counts a housemate opening their link" do
      group = create(:group)
      create(:member, group: group, last_seen_at: 3.days.ago)

      expect(last_activity_of(group)).to be_within(1.second).of(3.days.ago)
    end

    it "reports whichever of the three happened last" do
      group = create(:group)
      text_in(group, at: 9.days.ago)
      create(:group_admin, group: group, user: create(:user, last_seen_at: 4.days.ago))
      create(:member, group: group, last_seen_at: 6.days.ago)

      expect(last_activity_of(group)).to be_within(1.second).of(4.days.ago)
    end

    it "is still nothing for a house where none of the three has ever happened" do
      group = create(:group)
      create(:group_admin, group: group, user: create(:user, last_seen_at: nil))
      create(:member, group: group, last_seen_at: nil)

      expect(last_activity_of(group)).to be_nil
    end

    # An admin may run more than one house. Being seen in one of them is not activity in the other.
    it "does not carry an admin's visit over to another house they administer" do
      user = create(:user, last_seen_at: 1.day.ago)
      seen = create(:group, name: "Seen")
      unseen = create(:group, name: "Unseen")
      create(:group_admin, group: seen, user: user)
      create(:group_admin, group: unseen, user: create(:user, last_seen_at: nil))

      expect(last_activity_of(seen)).to be_within(1.second).of(1.day.ago)
      expect(last_activity_of(unseen)).to be_nil
    end

    # A house that went quiet a month ago is Quiet even though its texts are older still, and a
    # house whose admin logged in yesterday is not.
    it "is what the status pill is measured from" do
      group = create(:group, created_at: 1.year.ago)
      running_rota(group)
      text_in(group, at: 60.days.ago)

      expect(list.find { |row| row.fetch("id") == group.id }.fetch("status")).to eq("quiet")

      group.group_admins.create!(user: create(:user, last_seen_at: 1.day.ago), role: "admin")

      expect(list.find { |row| row.fetch("id") == group.id }.fetch("status")).to eq("live")
    end
  end

  # A house with something in every table the list counts, so no grouped query short-circuits on an
  # empty one — the three that make up `last_activity` included.
  def populated_house(name)
    group = create(:group, name: name)
    running_rota(group)
    create(:group_admin, group: group, user: create(:user, last_seen_at: 1.day.ago))
    create(:member, group: group, last_seen_at: 2.days.ago)
    text_in(group, at: 3.days.ago)
    group
  end

  # The counts are grouped queries over the whole page, not one query per row. The assertion is not
  # an upper bound — those drift upward — but that the cost does not move when the page gets bigger.
  it "costs the same number of queries for twenty houses as for two" do
    2.times { |n| populated_house("Small #{n}") }
    small = sql_selects_during { get "/api/super_admin/groups", headers: headers }
    expect(response).to have_http_status(:ok)

    18.times { |n| populated_house("Big #{n}") }
    big = sql_selects_during { get "/api/super_admin/groups", headers: headers }

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.fetch("groups").size).to eq(20)
    expect(big.size).to eq(small.size)
  end

  describe "the status pill" do
    def status_of(group) = list.find { |row| row.fetch("id") == group.id }.fetch("status")

    it "is live when something happened inside thirty days" do
      group = create(:group)
      running_rota(group)
      text_in(group, at: 3.days.ago)

      expect(status_of(group)).to eq("live")
    end

    it "is quiet when a running house has done nothing for thirty days" do
      group = create(:group)
      running_rota(group)
      text_in(group, at: 31.days.ago)

      expect(status_of(group)).to eq("quiet")
    end

    it "is quiet when a house that started a month ago has never sent anything" do
      group = create(:group, created_at: 31.days.ago)
      running_rota(group)

      expect(status_of(group)).to eq("quiet")
    end

    # The one house on this list where "Quiet" would be actively misleading: it was made this
    # morning and has not had a chance to send anything yet.
    it "is live for a brand new house that has not sent anything yet" do
      group = create(:group, created_at: 10.minutes.ago)
      running_rota(group)

      expect(status_of(group)).to eq("live")
    end

    # A house that ran for a year and then switched its rotas off has started. Reading that as
    # "never started" would put the label next to its own traffic.
    it "is not never started when its staffed rotas are merely switched off" do
      group = create(:group)
      rota = create(:rota, :inactive, group: group)
      create(:rota_position, rota: rota, member: create(:member, group: group), position: 0)
      text_in(group, rota: rota, at: 2.days.ago)

      expect(status_of(group)).to eq("live")
    end

    it "is quiet, not never started, when a paused house has also gone silent" do
      group = create(:group, created_at: 1.year.ago)
      rota = create(:rota, :inactive, group: group)
      create(:rota_position, rota: rota, member: create(:member, group: group), position: 0)
      text_in(group, rota: rota, at: 40.days.ago)

      expect(status_of(group)).to eq("quiet")
    end

    it "is never started when no rota has anyone on it, however new the house is" do
      group = create(:group)
      create(:rota, group: group)

      expect(status_of(group)).to eq("never_started")
    end

    it "is never started rather than quiet, because the two are different conversations" do
      group = create(:group, created_at: 1.year.ago)
      create(:rota, group: group)
      text_in(group, at: 40.days.ago)

      expect(status_of(group)).to eq("never_started")
    end

    # Suspended beats every other state: it is the one somebody chose, and an operator scanning the
    # list for houses to chase should not find their own decision filed under Quiet.
    it "is suspended for a paused house, whatever else is true of it" do
      group = create(:group, created_at: 1.year.ago, suspended_at: 1.day.ago)

      expect(status_of(group)).to eq("suspended")

      running_rota(group)
      text_in(group, at: 1.hour.ago)

      expect(status_of(group)).to eq("suspended")
    end

    it "goes back to what it was when the house is resumed" do
      group = create(:group, suspended_at: 1.day.ago)
      running_rota(group)
      text_in(group, at: 1.hour.ago)

      expect(status_of(group)).to eq("suspended")

      group.update!(suspended_at: nil)

      expect(status_of(group)).to eq("live")
    end

    it "turns from live to quiet as the thirty days pass" do
      group = create(:group)
      running_rota(group)
      text_in(group, at: Time.current)

      travel_to(29.days.from_now) { expect(status_of(group)).to eq("live") }
      travel_to(31.days.from_now) { expect(status_of(group)).to eq("quiet") }
    end
  end

  describe "search" do
    before do
      create(:group, name: "Alma Road")
      create(:group, name: "Bell Street")
    end

    it "matches part of a name, whatever the case" do
      expect(names(q: "alma")).to eq([ "Alma Road" ])
    end

    it "matches part of a slug" do
      slug = Group.find_by(name: "Bell Street").slug

      expect(names(q: slug.first(6))).to eq([ "Bell Street" ])
    end

    it "treats a wildcard as a literal, so it cannot be used to match everything" do
      expect(names(q: "%")).to be_empty
    end
  end

  describe "filters" do
    it "narrows to one status" do
      live = create(:group, name: "Live House")
      running_rota(live)
      text_in(live, at: 1.day.ago)
      create(:rota, group: create(:group, name: "Draft House"))

      expect(names(status: "never_started")).to eq([ "Draft House" ])
      expect(names(status: "live")).to eq([ "Live House" ])
    end

    it "returns nothing for a status that is not one of ours" do
      create(:group)

      expect(names(status: "banished")).to be_empty
    end

    it "narrows to the houses an operator has paused" do
      paused = create(:group, name: "Paused", suspended_at: 1.day.ago)
      running_rota(paused)
      live = create(:group, name: "Live House")
      running_rota(live)
      text_in(live, at: 1.day.ago)

      expect(names(status: "suspended")).to eq([ "Paused" ])
      expect(names(status: "live")).to eq([ "Live House" ])
    end

    it "narrows to houses nobody has confirmed a timezone for" do
      create(:group, name: "Guessed")
      create(:group, name: "Confirmed", timezone_confirmed_at: 1.day.ago)

      expect(names(unconfirmed_timezone: "true")).to eq([ "Guessed" ])
      expect(names(unconfirmed_timezone: "false").size).to eq(2)
    end

    it "narrows to houses whose texts are failing this week" do
      failing = create(:group, name: "Failing")
      text_in(failing, status: "failed", at: 1.day.ago)
      healthy = create(:group, name: "Healthy")
      text_in(healthy, at: 1.day.ago)
      stale = create(:group, name: "Stale Failure")
      text_in(stale, status: "failed", at: 10.days.ago)

      expect(names(has_failures: "1")).to eq([ "Failing" ])
    end
  end

  describe "sorting" do
    it "sorts by name by default, and for an order it does not know" do
      create(:group, name: "Bell Street")
      create(:group, name: "Alma Road")

      expect(names).to eq([ "Alma Road", "Bell Street" ])
      expect(names(sort: "drop table")).to eq([ "Alma Road", "Bell Street" ])
    end

    it "sorts newest house first" do
      create(:group, name: "Older", created_at: 2.days.ago)
      create(:group, name: "Newer", created_at: 1.hour.ago)

      expect(names(sort: "created")).to eq([ "Newer", "Older" ])
    end

    it "sorts by the most recent activity, with houses that have none last" do
      busy = create(:group, name: "Busy")
      text_in(busy, at: 1.hour.ago)
      stirring = create(:group, name: "Stirring")
      text_in(stirring, at: 5.days.ago)
      create(:group, name: "Silent")

      expect(names(sort: "last_activity")).to eq([ "Busy", "Stirring", "Silent" ])
    end

    it "sorts by the busiest week" do
      busy = create(:group, name: "Busy")
      rota = create(:rota, group: busy)
      member = create(:member, group: busy)
      2.times { |n| text_in(busy, rota: rota, member: member, at: n.days.ago) }
      quiet = create(:group, name: "Aquiet")
      text_in(quiet, at: 1.day.ago)

      expect(names(sort: "texts")).to eq([ "Busy", "Aquiet" ])
    end
  end
end
