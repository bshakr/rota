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
    it "cuts a name to the column's sane maximum rather than storing it whole" do
      expect(described_class.new(first_name: "b" * 500).name.length).to eq(described_class::MAX_LENGTH)
    end

    # An address meets the same cap and then has to pass the shape check, which the first 255
    # characters of a 500-character address do not. Better nothing at all than an address that is
    # nobody's, sitting in the row of someone we might one day try to reach.
    it "refuses an address too long to hold rather than storing the start of one" do
      expect(described_class.new(email: "#{'a' * 500}@example.com").email).to be_nil
    end
  end

  # Two rows can collide on an address and on nothing else (see User#absorb_workos_identity!), so an
  # address is held in one case and only when it is shaped like one. A name gets neither treatment:
  # it is a person's own spelling of themselves, and it is compared against nothing.
  describe "what it cleans out of a value" do
    it "downcases the address" do
      expect(described_class.new(email: "Alice@Example.COM").email).to eq("alice@example.com")
    end

    it "leaves a name in the case WorkOS gave it" do
      expect(described_class.new(first_name: "McDonald", last_name: "d'Eath").name).to eq("McDonald d'Eath")
    end

    it "is nil when what arrived is not shaped like an address at all" do
      expect(described_class.new(email: "not an email").email).to be_nil
      expect(described_class.new(email: "alice@").email).to be_nil
    end

    # Postgres refuses a NUL byte outright, and a request body can carry one. Nothing here raises on
    # it: `strip` takes it off either end, and an address still holding one in the middle is not an
    # address, so it yields nil rather than the cleaned value.
    it "does not raise on an embedded NUL and refuses the address holding one" do
      expect { described_class.new(email: "ali\u0000ce@example.com", first_name: "Ro\u0000sa") }.not_to raise_error
      expect(described_class.new(email: "ali\u0000ce@example.com").email).to be_nil
      expect(described_class.new(email: "alice@example.com\u0000").email).to eq("alice@example.com")
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
