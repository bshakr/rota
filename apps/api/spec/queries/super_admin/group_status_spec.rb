require "rails_helper"

# The pill's rules on their own. The list's behaviour is spec/requests/super_admin/groups_spec.rb;
# what is here is the precedence between the four states, and the one state that has no column to
# read yet.
RSpec.describe SuperAdmin::GroupStatus do
  def stats(running_rotas: 1, paused_rotas: 0, last_activity_at: Time.current)
    SuperAdmin::GroupStats::Row.empty
      .with(running_rotas: running_rotas, paused_rotas: paused_rotas, last_activity_at: last_activity_at)
  end

  def house(created_at: Time.current) = build(:group, created_at: created_at)

  it "is live while something is still happening" do
    expect(described_class.of(house, stats)).to eq("live")
  end

  it "is quiet after thirty days of nothing" do
    expect(described_class.of(house, stats(last_activity_at: 31.days.ago))).to eq("quiet")
  end

  it "is never started when no rota has a roster" do
    expect(described_class.of(house, stats(running_rotas: 0))).to eq("never_started")
  end

  it "prefers never started to quiet: a house that never began is not a house that went quiet" do
    expect(described_class.of(house, stats(running_rotas: 0, last_activity_at: nil))).to eq("never_started")
  end

  # "Started" is about whether anybody is on a rota, not about whether one is switched on.
  it "counts a staffed rota that is switched off as a house that has started" do
    started = stats(running_rotas: 0, paused_rotas: 1)

    expect(described_class.of(house, started)).to eq("live")
    expect(described_class.of(house(created_at: 1.year.ago), started.with(last_activity_at: nil))).to eq("quiet")
  end

  describe "a house with no activity at all" do
    it "is judged from the day it was created, not from the beginning of time" do
      expect(described_class.of(house(created_at: 10.minutes.ago), stats(last_activity_at: nil))).to eq("live")
      expect(described_class.of(house(created_at: 31.days.ago), stats(last_activity_at: nil))).to eq("quiet")
    end

    # An unsaved record has no created_at to measure from, and a status method is not where a
    # NoMethodError on nil should surface.
    it "is not quiet when there is no creation date to measure from either" do
      expect(described_class.of(Group.new, stats(last_activity_at: nil))).to eq("live")
    end
  end

  # BLO-1675 (https://linear.app/bloombase/issue/BLO-1675) adds `groups.suspended_at` and the
  # actions that set it. There is no such column yet, so no real Group can answer this — the stand-in
  # is a group that has the attribute, which is exactly what that migration will make every Group.
  # When it lands, delete this double and suspend a real one; the rule itself needs no edit.
  describe "the seam for suspension" do
    let(:suspendable) do
      Class.new(Group) do
        def self.name = "SuspendableGroup"
        attr_accessor :suspended_at
      end
    end

    it "beats every other state once the column exists" do
      group = suspendable.new(suspended_at: 1.day.ago)

      expect(described_class.of(group, stats(running_rotas: 0, last_activity_at: nil))).to eq("suspended")
    end

    it "leaves a group that is not suspended alone" do
      expect(described_class.of(suspendable.new(suspended_at: nil), stats)).to eq("live")
    end

    # Today, with no column, nothing can be suspended — so the list never shows a pill nobody can
    # have earned.
    it "cannot be reached by any real group yet" do
      expect(Group.new).not_to respond_to(:suspended_at)
    end
  end
end
