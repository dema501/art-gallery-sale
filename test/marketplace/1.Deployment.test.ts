import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { getAddress } from "viem";

import { deployMarketplaceFixture } from "../fixtures/marketplace.fixture";
import { TEST_CONSTANTS } from "../constants";

describe("1. Deployment and Initialization", function () {
  const { DEFAULT_ROYALTY_FEE } = TEST_CONSTANTS.FEES;

  it("1.1 should have correct name and symbol", async function () {
    const { artGallery } = await loadFixture(deployMarketplaceFixture);
    expect(await artGallery.read.name()).to.equal("ArtGallery NFT Market");
    expect(await artGallery.read.symbol()).to.equal("AGNFT");
  });

  it("1.2 should set deployer as owner", async function () {
    const { artGallery, owner } = await loadFixture(deployMarketplaceFixture);
    expect(await artGallery.read.owner()).to.equal(
      getAddress(owner.account.address),
    );
  });

  it("1.3 should set owner as initial admin and emit AdminStatusChanged event", async function () {
    const { artGallery, owner } = await loadFixture(deployMarketplaceFixture);
    const ownerAddress = getAddress(owner.account.address);
    expect(await artGallery.read.isAdmin([ownerAddress])).to.be.true;

    // Check event emitted by constructor
    const events = await artGallery.getEvents.AdminStatusChanged();
    expect(events).to.have.lengthOf(1); // Constructor emits exactly one
    expect(events[0].args.account).to.equal(ownerAddress);
    expect(events[0].args.isAdminStatus).to.be.true;
  });

  it("1.4 should have correct default royalty fee", async function () {
    const { artGallery } = await loadFixture(deployMarketplaceFixture);
    expect(await artGallery.read.royaltyFee()).to.equal(DEFAULT_ROYALTY_FEE);
  });

  it("1.5 should support required interfaces (IERC721, IERC2981)", async function () {
    const { artGallery } = await loadFixture(deployMarketplaceFixture);
    const ierc721InterfaceId = "0x80ac58cd";
    const ierc2981InterfaceId = "0x2a55205a";
    expect(await artGallery.read.supportsInterface([ierc721InterfaceId])).to.be
      .true;
    expect(await artGallery.read.supportsInterface([ierc2981InterfaceId])).to.be
      .true;
  });

  it("1.6 should initialize total artworks count to 0", async function () {
    const { artGallery } = await loadFixture(deployMarketplaceFixture);
    expect(await artGallery.read.getTotalArtworks()).to.equal(0n);
  });
});
