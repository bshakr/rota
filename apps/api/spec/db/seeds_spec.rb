require "rails_helper"

# Seeds are the difference between a working demo and an empty app, and nothing else in the suite
# would notice if a new required column quietly broke them — `db:prepare` only seeds a database it
# has just created, so a developer with an existing one would never find out.
RSpec.describe "db/seeds.rb" do
  def load_seeds
    original = $stdout
    $stdout = StringIO.new
    load Rails.root.join("db/seeds.rb").to_s
  ensure
    $stdout = original
  end

  let(:group) { Group.find_by!(workos_organization_id: "org_demo_flat_4") }

  before { load_seeds }

  it "produces the demo group" do
    expect(group.name).to eq("Flat 4, Alma Road")
    expect(group.timezone).to eq("Europe/London")
  end

  it "produces three members with dialable numbers" do
    expect(group.members.pluck(:name)).to contain_exactly("Alice", "Bob", "Cara")
    expect(group.members).to all(be_contactable)
    expect(group.members.map { |m| Phonelib.parse(m.phone_e164).valid? }).to all(be(true))
  end

  it "gives every member a magic-link token" do
    expect(group.members.map(&:access_token)).to all(be_present)
  end

  it "produces two rotas, neither of them stuck in draft" do
    expect(group.rotas.pluck(:name)).to contain_exactly("Kitchen deep clean", "Bins out")
    expect(group.rotas.map(&:draft?)).to all(be(false))
  end

  it "puts the whole house on the kitchen rota, in running order" do
    kitchen = group.rotas.find_by!(name: "Kitchen deep clean")

    expect(kitchen.members.map(&:name)).to eq(%w[Alice Bob Cara])
    expect(kitchen.reminder_offsets).to eq([ 3, 0 ])
  end

  # A rota's roster is its own ordered subset of the group, so the demo had better show one.
  it "puts only some of the house on the bins rota" do
    bins = group.rotas.find_by!(name: "Bins out")

    expect(bins.members.map(&:name)).to eq(%w[Bob Cara])
  end

  # Shifts come from ShiftGenerator. Inventing rows here would mean inventing them by a different
  # rule than the one the app actually uses.
  it "generates no shifts" do
    expect(Shift.count).to eq(0)
  end

  it "changes nothing when run again, and never rotates a member's magic link" do
    counts = -> { [ Group.count, Member.count, Rota.count, RotaPosition.count ] }
    before_counts = counts.call
    before_tokens = group.members.order(:name).pluck(:access_token)

    load_seeds

    expect(counts.call).to eq(before_counts)
    # A rotated token is a dead magic link in everyone's SMS history.
    expect(group.members.order(:name).pluck(:access_token)).to eq(before_tokens)
  end
end
