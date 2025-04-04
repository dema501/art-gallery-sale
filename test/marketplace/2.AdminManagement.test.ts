import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { getAddress } from "viem";
import hre from "hardhat";

import {
  deployMarketplaceFixture,
  designatedAdminFixture,
} from "../fixtures/marketplace.fixture";

describe("2. Admin Management (`setAdmin`)", function () {
  it("2.1 should allow owner to add a new admin", async function () {
    const { artGallery, owner, designatedAdmin, publicClient } =
      await loadFixture(deployMarketplaceFixture);
    const adminAddress = getAddress(designatedAdmin.account.address);
    const ownerAddress = getAddress(owner.account.address);

    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );

    const txHash = await artGalleryAsOwner.write.setAdmin([adminAddress, true]);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    expect(await artGallery.read.isAdmin([adminAddress])).to.be.true;

    const events = await artGallery.getEvents.AdminStatusChanged(
      {},
      {
        fromBlock: 0n, // Start from genesis block
        toBlock: receipt.blockNumber,
      },
    );

    expect(events.length).to.have.greaterThanOrEqual(2); // At least constructor + this add
    expect(events[0].args.account).to.equal(ownerAddress);
    expect(events[0].args.isAdminStatus).to.be.true;

    // Check the last event emitted
    expect(events[events.length - 1].args.account).to.equal(adminAddress);
    expect(events[events.length - 1].args.isAdminStatus).to.be.true;
  });

  it("2.2 should allow owner to remove an admin", async function () {
    const { artGallery, owner, designatedAdmin, publicClient } =
      await loadFixture(designatedAdminFixture); // Use fixture where designatedAdmin is already admin
    const adminAddress = getAddress(designatedAdmin.account.address);
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );

    expect(await artGallery.read.isAdmin([adminAddress])).to.be.true; // Verify pre-condition

    const removeTxHash = await artGalleryAsOwner.write.setAdmin([
      adminAddress,
      false,
    ]);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: removeTxHash,
    });
    expect(await artGallery.read.isAdmin([adminAddress])).to.be.false;

    const events = await artGallery.getEvents.AdminStatusChanged(
      {},
      {
        fromBlock: 0n, // Start from genesis block
        toBlock: receipt.blockNumber,
      },
    );
    expect(events.length).to.have.greaterThanOrEqual(2); // At least constructor + add + this remove
    // Check the last event emitted
    expect(events[events.length - 1].args.account).to.equal(adminAddress);
    expect(events[events.length - 1].args.isAdminStatus).to.be.false;
  });

  it("2.3 should NOT allow non-owner (even an admin) to manage admins", async function () {
    const { artGallery, designatedAdmin, otherAccount } = await loadFixture(
      designatedAdminFixture,
    ); // designatedAdmin is admin here
    const artGalleryAsAdmin = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: designatedAdmin } },
    );
    const artGalleryAsOther = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: otherAccount } },
    );

    // Admin tries to add another admin
    await expect(
      artGalleryAsAdmin.write.setAdmin([
        getAddress(otherAccount.account.address),
        true,
      ]),
    ).to.be.rejectedWith("OwnableUnauthorizedAccount");

    // Regular user tries to add an admin
    await expect(
      artGalleryAsOther.write.setAdmin([
        getAddress(designatedAdmin.account.address),
        true,
      ]),
    ).to.be.rejectedWith("OwnableUnauthorizedAccount");
  });
});
