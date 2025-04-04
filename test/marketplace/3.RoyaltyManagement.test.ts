import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { getAddress, zeroAddress } from "viem";
import hre from "hardhat";

import {
  deployMarketplaceFixture,
  designatedAdminFixture,
  listedArtworkFixture,
} from "../fixtures/marketplace.fixture";
import { TEST_CONSTANTS } from "../constants";

describe("3. Royalty Management (`setRoyaltyFee`, `royaltyInfo`)", function () {
  const { ONE_ETHER } = TEST_CONSTANTS.PRICES;
  const { NON_EXISTENT_ID: NON_EXISTENT_TOKEN_ID } = TEST_CONSTANTS.TOKENS;
  const { SAMPLE_ROYALTY_FEE_BPS, MAX_ROYALTY_FEE } = TEST_CONSTANTS.FEES;

  it("3.1 should allow any admin to set a valid royalty fee", async function () {
    const { artGallery, owner, designatedAdmin, publicClient } =
      await loadFixture(designatedAdminFixture);
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );
    const artGalleryAsAdmin = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: designatedAdmin } },
    );

    // Owner sets fee
    const fee1 = 500n; // 5%
    const tx1 = await artGalleryAsOwner.write.setRoyaltyFee([fee1]);
    const receipt1 = await publicClient.waitForTransactionReceipt({
      hash: tx1,
    });
    expect(await artGallery.read.royaltyFee()).to.equal(fee1);

    // Designated admin sets fee
    const fee2 = 1000n; // 10%
    const tx2 = await artGalleryAsAdmin.write.setRoyaltyFee([fee2]);
    const receipt2 = await publicClient.waitForTransactionReceipt({
      hash: tx2,
    });
    expect(await artGallery.read.royaltyFee()).to.equal(fee2);

    const events = await artGallery.getEvents.RoyaltyFeeUpdated({
      fromBlock: receipt1.blockNumber,
      toBlock: receipt2.blockNumber,
    });
    expect(events.length).to.have.greaterThanOrEqual(2); // At least these two settings
    expect(events[0].args.newFee).to.equal(fee1); // Check last setting
    expect(events[events.length - 1].args.newFee).to.equal(fee2); // Check last setting
  });

  it("3.2 should NOT allow setting royalty fee above maximum", async function () {
    const { artGallery, owner } = await loadFixture(deployMarketplaceFixture);
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );

    await expect(
      artGalleryAsOwner.write.setRoyaltyFee([MAX_ROYALTY_FEE + 1n]),
    ).to.be.rejectedWith("ArtGalleryMarketplace__InvalidRoyaltyFee");
  });

  it("3.3 should NOT allow non-admin to set royalty fee", async function () {
    const { artGallery, otherAccount } = await loadFixture(
      deployMarketplaceFixture,
    );
    const artGalleryAsOther = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: otherAccount } },
    );

    await expect(
      artGalleryAsOther.write.setRoyaltyFee([SAMPLE_ROYALTY_FEE_BPS]),
    ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin");
  });

  it("3.4 should calculate correct royalty via `royaltyInfo` when fee is set", async function () {
    const { artGallery, owner, artist1, publicClient, tokenId } =
      await loadFixture(listedArtworkFixture);
    const artistAddress = getAddress(artist1.account.address);
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );

    // Set royalty fee
    const txHash = await artGalleryAsOwner.write.setRoyaltyFee([
      SAMPLE_ROYALTY_FEE_BPS,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: txHash }); // Ensure confirmed

    const [receiver, royaltyAmount] = await artGallery.read.royaltyInfo([
      tokenId,
      ONE_ETHER,
    ]);
    const expectedRoyalty = (ONE_ETHER * SAMPLE_ROYALTY_FEE_BPS) / 10000n;

    expect(receiver).to.equal(artistAddress);
    expect(royaltyAmount).to.equal(expectedRoyalty);
  });

  it("3.5 should calculate zero royalty via `royaltyInfo` if fee is zero", async function () {
    const { artGallery, artist1, tokenId } =
      await loadFixture(listedArtworkFixture);
    const artistAddress = getAddress(artist1.account.address);
    // Fee is 0 by default in fixture

    const [receiver, royaltyAmount] = await artGallery.read.royaltyInfo([
      tokenId,
      ONE_ETHER,
    ]);

    // Check the contract's royaltyInfo implementation:
    // if (artist == address(0) || royaltyFee == 0) {
    //     return (address(0), 0);
    // }

    // Since royaltyFee is 0, the contract returns address(0) as receiver
    expect(receiver).to.equal(zeroAddress); // Changed from artistAddress
    expect(royaltyAmount).to.equal(0n);
  });

  it("3.6 should calculate zero royalty via `royaltyInfo` for non-existent token", async function () {
    const { artGallery, owner, publicClient } = await loadFixture(
      deployMarketplaceFixture,
    );
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );

    // Set a non-zero fee
    const txHash = await artGalleryAsOwner.write.setRoyaltyFee([
      SAMPLE_ROYALTY_FEE_BPS,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    const [receiver, royaltyAmount] = await artGallery.read.royaltyInfo([
      NON_EXISTENT_TOKEN_ID,
      ONE_ETHER,
    ]);

    expect(receiver).to.equal(zeroAddress); // Because artist defaults to 0
    expect(royaltyAmount).to.equal(0n); // Because artist is 0
  });
});
