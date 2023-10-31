// deno-lint-ignore-file no-explicit-any
import { FindOneQuery } from "../lib/query/find.ts";
import { Mongo, ObjectId } from "../mod.ts";
import { e } from "../deps.ts";

const Cache = new Map<
  string,
  {
    value: any;
    ttl: number;
    time: number;
  }
>();

const PostsData = [
  {
    title: "Test",
    description: "This is a test post.",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const UsersData = [
  {
    username: "saffellikhan",
    profile: {
      name: "Saif Ali Khan",
      dob: new Date(),
    },
  },
  {
    username: "abdullah",
    password: "secret3",
    profile: {
      name: "Abdullah Khan",
      dob: new Date(),
    },
  },
];

Deno.test({
  name: "Array Validator Tests",
  async fn(t) {
    Mongo.enableLogs = true;

    await Mongo.connect("mongodb://localhost:27017/mongo");
    await Mongo.drop();

    // Setup Caching
    Mongo.setCachingMethods(
      (key, value, ttl) => {
        Cache.set(key, { value, ttl, time: Date.now() / 1000 });
      },
      (key) => {
        const Value = Cache.get(key);
        if (Value && Value.ttl + Value.time >= Date.now() / 1000)
          return Value.value;
      },
      (key) => {
        Cache.delete(key);
      }
    );

    // User Schema
    const UserSchema = e.object({
      _id: e.optional(
        e.if(ObjectId.isValid).custom((ctx) => new ObjectId(ctx.output))
      ),
      username: e.string(),
      password: e.optional(e.string()).default("topSecret"),
      profile: e.object({
        name: e.string(),
        dob: e.date(),
      }),
      age: e.optional(e.number()).default(18),
      followers: e.optional(e.array(e.if(ObjectId.isValid))),
      posts: e.optional(e.array(e.if(ObjectId.isValid))),
      latestPost: e.optional(e.if(ObjectId.isValid)),
      createdAt: e.optional(e.date()).default(() => new Date()),
      updatedAt: e.optional(e.date()).default(() => new Date()),
    });

    const UserModel = Mongo.model("user", UserSchema);

    UserModel.pre("update", (details) => {
      details.updates.$set = {
        ...details.updates.$set,
        updatedAt: new Date(),
      };
    });

    // Post Schema
    const PostSchema = e.object({
      _id: e
        .optional(e.if(ObjectId.isValid))
        .custom((ctx) => new ObjectId(ctx.output)),
      title: e.string(),
      description: e.string(),
      drafted: e.optional(e.boolean()).default(true),
      createdAt: e.optional(e.date()).default(() => new Date()),
      updatedAt: e.optional(e.date()).default(() => new Date()),
    });

    const PostModel = Mongo.model("post", PostSchema);

    PostModel.pre("update", (details) => {
      details.updates.$set = {
        ...details.updates.$set,
        updatedAt: new Date(),
      };
    });

    // User with Posts
    const UserWithPostsSchema = e.required(
      e.omit(UserSchema, { keys: ["posts", "latestPost"] }).extends(
        e.object({
          posts: e.array(PostSchema),
          latestPost: PostSchema,
        })
      ),
      { ignore: ["followers"] }
    );

    await t.step("Create Indexes", async () => {
      await UserModel.createIndex(
        {
          key: { username: 1 },
          unique: true,
          background: true,
          partialFilterExpression: { username: { $exists: true } },
        },
        {
          key: { username: "text", "profile.name": "text" },
          background: true,
        }
      );
    });

    await t.step("Create Users and Posts", async () => {
      // Create Users
      const Users = await UserModel.createMany(UsersData);

      // Check if the result is a valid Users list
      await e.array(UserSchema).validate(Users);

      // Create Post
      const Post = await PostModel.create(PostsData[0]);

      // Check if the result is a valid Post
      await PostSchema.validate(Post);

      // Relate first User with the Post
      await UserModel.updateOne(Users[0]._id, {
        $push: { posts: Post._id },
        latestPost: Post._id,
      });
    });

    await t.step("Fetch with populate", async () => {
      const Query = UserModel.findOne()
        .populate("posts", PostModel)
        .populateOne("latestPost", PostModel);

      await e.instanceOf(FindOneQuery).validate(Query);

      const User = await Query;

      await UserWithPostsSchema.validate(User);
    });

    await t.step("Updates", async () => {
      // Wait for a sec to fix the time issue
      await new Promise((_) => setTimeout(_, 1000));

      const Users = await UserModel.updateAndFindMany(
        {},
        { "profile.dob": new Date() }
      );

      Users.map((user, i) => {
        if (user.profile.dob.toString() === UsersData[i].profile.dob.toString())
          throw new Error(`Date of birth not updated!`);
      });

      const Post = await PostModel.updateAndFindOne({}, {});

      if (
        Post &&
        (Post.updatedAt.toString() === PostsData[0].updatedAt.toString() ||
          Post.createdAt.toString() !== PostsData[0].createdAt.toString())
      )
        throw new Error(`Hook didn't update the modification time!`);
    });

    await t.step("Delete", async () => {
      await UserModel.deleteOne({});

      if ((await UserModel.count()) !== 1)
        throw new Error(`First user deletion failed!`);

      await UserModel.deleteMany();

      if ((await UserModel.count()) !== 0)
        throw new Error(`Deletion not correct!`);
    });

    Mongo.disconnect();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
