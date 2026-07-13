require "rails_helper"

# Unit-level coverage of the token verifier's edge policies. The end-to-end 401 matrix lives in
# spec/requests/api/authentication_spec.rb; this file pins the issuer and audience rules that are
# easier to state directly, including the ones that only differ in production.
RSpec.describe WorkosAccessToken do
  def verify(**claims)
    described_class.verify!(workos_token(**claims))
  end

  describe ".verify! issuer policy" do
    it "accepts the client-scoped issuer WorkOS documents" do
      expect { verify(iss: "https://api.workos.com/user_management/#{WorkosAuth.client_id}") }.not_to raise_error
    end

    it "rejects a client-scoped issuer naming a different WorkOS client" do
      expect { verify(iss: "https://api.workos.com/user_management/client_01SOMEONE_ELSE") }
        .to raise_error(described_class::InvalidToken)
    end

    it "rejects an issuer on a host that is not WorkOS" do
      expect { verify(iss: "https://evil.example.com/user_management/#{WorkosAuth.client_id}") }
        .to raise_error(described_class::InvalidToken)
    end

    # WorkOS documents a bare issuer too. It does not name a client, so outside production it is a
    # convenience; in production it is refused so isolation never rests solely on WorkOS's per-client
    # key serving.
    context "with the bare issuer WorkOS also documents" do
      it "accepts it outside production" do
        expect { verify(iss: "https://api.workos.com/") }.not_to raise_error
      end

      it "refuses it in production" do
        allow(Rails).to receive(:env).and_return(ActiveSupport::StringInquirer.new("production"))

        expect { verify(iss: "https://api.workos.com/") }.to raise_error(described_class::InvalidToken)
      end
    end

    context "when WORKOS_JWT_ISSUER pins an exact issuer" do
      around do |example|
        original = Rails.application.config.x.workos.issuer
        Rails.application.config.x.workos.issuer = "https://auth.houserota.example/"
        example.run
        Rails.application.config.x.workos.issuer = original
      end

      it "accepts exactly that issuer" do
        expect { verify(iss: "https://auth.houserota.example/") }.not_to raise_error
      end

      it "refuses even the otherwise-valid client-scoped issuer" do
        expect { verify(iss: "https://api.workos.com/user_management/#{WorkosAuth.client_id}") }
          .to raise_error(described_class::InvalidToken)
      end
    end
  end

  describe ".verify! audience policy" do
    it "accepts a token with no audience — an AuthKit access token carries none" do
      expect { verify(aud: nil) }.not_to raise_error
    end

    it "accepts a token whose audience is this app" do
      expect { verify(aud: WorkosAuth.client_id) }.not_to raise_error
    end

    it "accepts a token whose audience array contains this app" do
      expect { verify(aud: [ WorkosAuth.client_id, "client_01OTHER" ]) }.not_to raise_error
    end

    it "refuses a token whose audience is a different app" do
      expect { verify(aud: "client_01OTHER_APP") }.to raise_error(described_class::InvalidToken)
    end
  end

  describe ".verify! claims" do
    it "returns the workos ids, role, and any email/name the template supplied" do
      claims = verify(sub: "user_01ALICE", org_id: "org_01FLAT", role: "admin", email: "a@example.com", name: "Alice")

      expect(claims).to have_attributes(
        workos_user_id: "user_01ALICE",
        workos_organization_id: "org_01FLAT",
        role: "admin",
        email: "a@example.com",
        name: "Alice"
      )
    end

    it "defaults an absent role to member, since WorkOS may configure an org without one" do
      expect(verify(role: nil).role).to eq("member")
    end
  end

  describe ".verify! expiry" do
    # Rails' clock and WorkOS's are never perfectly aligned, so a small leeway keeps a token that is
    # a second or two past expiry from being refused over skew alone.
    it "accepts a token a few seconds past expiry, within the leeway" do
      expect { verify(exp: 10.seconds.ago.to_i) }.not_to raise_error
    end

    it "refuses a token well past expiry" do
      expect { verify(exp: 5.minutes.ago.to_i) }.to raise_error(described_class::InvalidToken)
    end
  end

  describe ".inspect_claims" do
    it "returns the full header and payload plus whether issuer and audience would pass" do
      result = described_class.inspect_claims(workos_token(aud: WorkosAuth.client_id))

      expect(result[:header]).to include("kid" => WorkosAuth::KID, "alg" => "RS256")
      expect(result[:payload]).to include("sub", "org_id", "iss")
      expect(result).to include(issuer_trusted: true, audience_accepted: true)
    end

    it "reports a mismatched audience without raising, so a real token can be examined" do
      result = described_class.inspect_claims(workos_token(aud: "client_01OTHER_APP"))

      expect(result[:audience_accepted]).to be(false)
    end
  end
end
