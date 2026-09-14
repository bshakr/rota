require "rails_helper"

# The normalising half of BLO-1696. Two sources hand us the same three fields — a request body from
# the AuthKit callback, and the WorkOS directory — and neither is tidy: WorkOS returns "" and nil for
# the same empty signup field, and a request body can contain anything at all.
RSpec.describe WorkosIdentity do
  describe "the name it assembles" do
    it "joins the two halves WorkOS holds" do
      expect(described_class.new(first_name: "Rosa", last_name: "Okoro").name).to eq("Rosa Okoro")
    end

    it "uses whichever half exists when only one does" do
      expect(described_class.new(first_name: "Rosa").name).to eq("Rosa")
      expect(described_class.new(last_name: "Okoro").name).to eq("Okoro")
    end

    # The heading slot on the operator console has to hold a person or a phrase, never a space.
    it "is nil when both halves are blank" do
      expect(described_class.new(first_name: "", last_name: "   ").name).to be_nil
      expect(described_class.new.name).to be_nil
    end

    it "trims what WorkOS was handed by a signup form" do
      expect(described_class.new(first_name: "  Rosa ", last_name: " Okoro  ").name).to eq("Rosa Okoro")
    end
  end

  describe "the address" do
    it "is what WorkOS holds, trimmed" do
      expect(described_class.new(email: "  rosa@example.com ").email).to eq("rosa@example.com")
    end

    it "is nil rather than blank when there is nothing there" do
      expect(described_class.new(email: "   ").email).to be_nil
      expect(described_class.new.email).to be_nil
    end
  end

  # `users.email` and `users.name` are unbounded varchars and one source for this is a request body.
  describe "a value far longer than a name" do
    it "is cut to the column's sane maximum rather than stored whole" do
      identity = described_class.new(email: "#{'a' * 500}@example.com", first_name: "b" * 500)

      expect(identity.email.length).to eq(described_class::MAX_LENGTH)
      expect(identity.name.length).to eq(described_class::MAX_LENGTH)
    end
  end

  # The request body is the only input to this whole feature that nothing signed, so what it may
  # become is worth stating outright.
  describe ".from_params" do
    it "reads the three fields the web app posts" do
      identity = described_class.from_params(
        ActionController::Parameters.new(email: "rosa@example.com", first_name: "Rosa", last_name: "Okoro")
      )

      expect(identity.email).to eq("rosa@example.com")
      expect(identity.name).to eq("Rosa Okoro")
    end

    it "ignores anything that is not a string" do
      identity = described_class.from_params(
        ActionController::Parameters.new(email: { "$ne" => nil }, first_name: [ 1, 2 ], last_name: 7)
      )

      expect(identity.email).to be_nil
      expect(identity.name).to be_nil
      expect(identity).not_to be_any
    end

    it "ignores every other param on the request" do
      identity = described_class.from_params(
        ActionController::Parameters.new(controller: "api/sign_ins", action: "create", workos_user_id: "user_01EVIL")
      )

      expect(identity).not_to be_any
    end
  end
end
