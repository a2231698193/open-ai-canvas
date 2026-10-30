import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseContributors } from "../src/pages/welcome/contributors-parse";

const identityAvatar = (path: string) => path;

test("welcome contributors parse the CONTRIBUTORS HTML table", () => {
    const contributors = readFileSync(resolve(import.meta.dir, "../../CONTRIBUTORS.md"), "utf8");
    const people = parseContributors(contributors, identityAvatar);

    expect(people.length).toBeGreaterThanOrEqual(20);
    expect(people[0]).toMatchObject({
        name: "ddCat",
        avatar: "assets/user-ddcat.jpg",
        email: "ddcat666@126.com",
        isFounder: true,
    });
    expect(people.some((person) => person.name === "morrow" && person.email === "3201190041@qq.com" && person.signature === "最难不过坚持")).toBe(true);
    expect(people.some((person) => person.name === "春秋" && person.avatar === "assets/user-chunqiu.jpg" && person.email === "558328@qq.com")).toBe(true);
    expect(people.some((person) => person.name === "亿媒网老宋" && person.avatar === "assets/user-song.jpg" && person.email === "61731514@qq.com" && person.signature === "全国10W+媒体、自媒体，助力企业品牌传播")).toBe(true);
});

test("welcome contributors still parse markdown pipe tables", () => {
    const markdown = `## 贡献者与团队

| 头像 | 昵称 | 邮箱 | 签名 |
| --- | --- | --- | --- |
| <img src="assets/user-example.jpg" alt="Example"> | Example<br>项目发起者 · 微信：example-id | founder@example.com | 把故事搬上银幕 |
| <img src="assets/user-ken.jpg" alt="ken"> | ken | ken@example.com | 走自己的路 |

## 下一章
`;
    expect(parseContributors(markdown, identityAvatar)).toEqual([
        {
            name: "Example",
            avatar: "assets/user-example.jpg",
            signature: "把故事搬上银幕",
            email: "founder@example.com",
            wechat: "example-id",
            isFounder: true,
        },
        {
            name: "ken",
            avatar: "assets/user-ken.jpg",
            signature: "走自己的路",
            email: "ken@example.com",
            wechat: undefined,
            isFounder: false,
        },
    ]);
});
