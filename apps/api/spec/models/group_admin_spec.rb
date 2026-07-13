require "rails_helper"

RSpec.describe GroupAdmin do
  it "is valid with the factory" do
    expect(build(:group_admin)).to be_valid
  end

  it "requires a role" do
    group_admin = build(:group_admin, role: "")

    expect(group_admin).not_to be_valid
    expect(group_admin.errors[:role]).to be_present
  end

  # The row is upserted from the JWT claims on every authenticated request, so it has to be the
  # same row every time.
  it "refuses to admit the same user to the same group twice" do
    existing = create(:group_admin)
    duplicate = build(:group_admin, user: existing.user, group: existing.group)

    expect(duplicate).not_to be_valid
    expect(duplicate.errors[:user_id]).to be_present
  end

  it "allows one user to administer several groups" do
    existing = create(:group_admin)

    expect(build(:group_admin, user: existing.user, group: create(:group))).to be_valid
  end

  it "allows one group to have several admins" do
    existing = create(:group_admin)

    expect(build(:group_admin, user: create(:user), group: existing.group)).to be_valid
  end
end
