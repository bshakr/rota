require "rails_helper"

RSpec.describe "Household entry slugs" do
  it "gives identically named houses distinct valid links" do
    one = create(:group, name: "Park Vista")
    two = create(:group, name: "Park Vista")
    expect(one.slug).to match(/\Apark-vista-[a-f0-9]{8}\z/)
    expect(two.slug).not_to eq(one.slug)
  end

  it "keeps the existing link when a house is renamed" do
    group = create(:group)
    expect { group.update!(name: "New Name") }.not_to change { group.reload.slug }
  end

  it "supports names without Latin characters" do
    expect(create(:group, name: "🏠").slug).to start_with("household-")
  end

  it "normalizes the WorkOS organization ID used as the JIT name" do
    expect(create(:group, name: "org_01FLAT").slug).to start_with("org-01flat-")
    expect(create(:group, name: "__House__").slug).to start_with("house-")
  end
end
