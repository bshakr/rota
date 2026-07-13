require "rails_helper"

RSpec.describe User do
  it "is valid with the factory" do
    expect(build(:user)).to be_valid
  end

  it "requires a WorkOS user to map onto" do
    user = build(:user, workos_user_id: nil)

    expect(user).not_to be_valid
    expect(user.errors[:workos_user_id]).to be_present
  end

  it "refuses two users for the same WorkOS user" do
    create(:user, workos_user_id: "user_taken")
    duplicate = build(:user, workos_user_id: "user_taken")

    expect(duplicate).not_to be_valid
    expect(duplicate.errors[:workos_user_id]).to be_present
  end

  it "requires an email" do
    user = build(:user, email: "")

    expect(user).not_to be_valid
    expect(user.errors[:email]).to be_present
  end

  # WorkOS does not always have a name, and the just-in-time upsert on an authenticated request
  # must never fail for want of a display string.
  it "does not require a name" do
    expect(build(:user, name: nil)).to be_valid
  end

  it "reaches its groups through group_admins" do
    user = create(:user)
    group = create(:group)
    create(:group_admin, user: user, group: group)

    expect(user.groups).to contain_exactly(group)
  end
end
