#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const root = process.env.PACKAGES_ROOT || "/private/tmp/flythings-z21-packages-full";
const api = "https://package.flythings.cn/api/platforms/z21/packages";
const packages = [
	["easyui", "2.6.0"], ["log", "0.0.0"], ["zkhardware", "0.0.0"],
	["zknet", "0.0.0"], ["base-utility", "10.9.3"], ["ext4", "0.0.1"],
	["transfer-protocols", "3.0.0"], ["audio-utility", "5.1.1"],
	["base-json", "3.0.3"], ["ffmpeg", "4.1.9"], ["mi_ao", "0.0.0"],
	["mi_common", "0.0.0"], ["mi_sys", "0.0.0"], ["cam_os_wrapper", "0.0.0"],
	["apc", "0.0.0"], ["aec", "0.0.0"], ["z", "1.2.11"],
];

function safeRelativePath(value) {
	const normalized = path.posix.normalize(value);
	if (!value || normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
		throw new Error(`Unsafe SDK path from package repository: ${value}`);
	}
	return normalized;
}

async function listDirectory(base, relative = "") {
	const encodedPath = relative ? `/${relative.split("/").map(encodeURIComponent).join("/")}` : "";
	const response = await fetch(`${base}/files${encodedPath}?pageSize=1000`);
	if (!response.ok) throw new Error(`SDK directory request failed (${response.status}): ${relative || "."}`);
	const payload = await response.json();
	return payload.data?.items || [];
}

async function downloadTree(base, destination, relative = "") {
	const entries = await listDirectory(base, relative);
	for (const entry of entries) {
		const child = safeRelativePath(relative ? `${relative}/${entry.name}` : entry.name);
		if (entry.dir) {
			await downloadTree(base, destination, child);
			continue;
		}
		const encodedPath = child.split("/").map(encodeURIComponent).join("/");
		const response = await fetch(`${base}/files/${encodedPath}`);
		if (!response.ok) throw new Error(`SDK file request failed (${response.status}): ${child}`);
		const target = path.join(destination, child);
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
		process.stdout.write(`Fetched ${path.basename(destination)}:${child}\n`);
	}
}

for (const [name, version] of packages) {
	const base = `${api}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`;
	const destination = path.join(root, `${name}-${version}`, "content");
	await fs.mkdir(destination, { recursive: true });
	await downloadTree(base, destination);
}

process.stdout.write(`FlyThings Z21 packages downloaded to ${root}\n`);
