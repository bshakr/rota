require "rails_helper"

RSpec.describe Member do
  describe "validations" do
    it "is valid with the factory" do
      expect(build(:member)).to be_valid
    end

    it "requires a name" do
      member = build(:member, name: "")

      expect(member).not_to be_valid
      expect(member.errors[:name]).to be_present
    end

    it "requires a phone number" do
      member = build(:member, phone_e164: "")

      expect(member).not_to be_valid
      expect(member.errors[:phone_e164]).to be_present
    end
  end

  # A bad phone number is the top cause of a silently missed reminder, so it is rejected at the
  # form rather than discovered three weeks later when nobody cleaned the kitchen.
  describe "phone normalisation" do
    it "normalises a number typed in national form to E.164" do
      expect(create(:member, phone_e164: "07123 456789").phone_e164).to eq("+447123456789")
    end

    it "normalises a number typed with punctuation" do
      expect(create(:member, phone_e164: "(07123) 456-789").phone_e164).to eq("+447123456789")
    end

    it "leaves a number already in E.164 alone" do
      expect(create(:member, phone_e164: "+447123456789").phone_e164).to eq("+447123456789")
    end

    it "normalises a number typed with an international prefix and spaces" do
      expect(create(:member, phone_e164: "+44 7123 456789").phone_e164).to eq("+447123456789")
    end

    it "rejects an unparseable number rather than storing something undialable" do
      member = build(:member, phone_e164: "not a phone number")

      expect(member).not_to be_valid
      expect(member.errors[:phone_e164]).to include("is not a valid phone number")
    end

    it "rejects a number that is too short to dial" do
      member = build(:member, phone_e164: "12345")

      expect(member).not_to be_valid
      expect(member.errors[:phone_e164]).to be_present
    end

    it "rejects a number that libphonenumber knows is not assignable" do
      # Ofcom reserves 07700 900xxx for drama, and libphonenumber knows it will never connect.
      member = build(:member, phone_e164: "07700 900123")

      expect(member).not_to be_valid
      expect(member.errors[:phone_e164]).to be_present
    end

    it "keeps what was typed in the attribute so the error names it back" do
      member = build(:member, phone_e164: "not a phone number")
      member.validate

      expect(member.phone_e164).to eq("not a phone number")
    end
  end

  describe "access token" do
    it "generates one on create" do
      expect(create(:member).access_token).to be_present
    end

    it "generates a 32-byte URL-safe token" do
      token = create(:member).access_token

      # 32 bytes of base64, unpadded.
      expect(token.length).to eq(43)
      expect(token).to match(/\A[A-Za-z0-9_-]+\z/)
    end

    it "gives every member a different token" do
      tokens = create_list(:member, 5).map(&:access_token)

      expect(tokens.uniq.length).to eq(5)
    end

    it "does not overwrite a token that was supplied" do
      expect(create(:member, access_token: "chosen-token").access_token).to eq("chosen-token")
    end

    it "rotates the token, so a lost phone's magic link stops working" do
      member = create(:member)
      original = member.access_token

      member.rotate_access_token!

      expect(member.reload.access_token).to be_present
      expect(member.access_token).not_to eq(original)
    end

    it "refuses two members the same token" do
      create(:member, access_token: "taken")
      duplicate = build(:member, access_token: "taken")

      expect(duplicate).not_to be_valid
      expect(duplicate.errors[:access_token]).to be_present
    end
  end

  describe "who the system may still text" do
    it "counts an active member who has not opted out" do
      expect(create(:member)).to be_contactable
    end

    it "does not count an inactive member" do
      expect(create(:member, :inactive)).not_to be_contactable
    end

    it "does not count a member who has opted out" do
      expect(create(:member, :opted_out)).not_to be_contactable
    end

    # Scoped through the group rather than queried globally, because that is how every real query
    # reaches members — and because a spec that assumes an empty table goes red the first time
    # anyone seeds the test database.
    it "scopes to the contactable members" do
      group = create(:group)
      contactable = create(:member, group: group)
      create(:member, :inactive, group: group)
      create(:member, :opted_out, group: group)

      expect(group.members.contactable).to contain_exactly(contactable)
    end

    it "scopes to the active members regardless of opt-out" do
      group = create(:group)
      active = create(:member, group: group)
      opted_out = create(:member, :opted_out, group: group)
      create(:member, :inactive, group: group)

      expect(group.members.active).to contain_exactly(active, opted_out)
    end
  end

  # Past shifts record who was actually responsible. Destroying a member who appears in one would
  # rewrite that history, so the way to remove someone is to deactivate them.
  describe "destroying" do
    it "refuses while the member still holds a shift" do
      shift = create(:shift)

      expect(shift.assigned_member.destroy).to be(false)
      expect(shift.assigned_member.errors[:base]).to be_present
    end

    it "refuses while the member is covering a shift" do
      shift = create(:shift, :covered)

      expect(shift.covering_member.destroy).to be(false)
    end

    it "allows a member who has never been given a shift" do
      expect(create(:member).destroy).to be_truthy
    end
  end
end
