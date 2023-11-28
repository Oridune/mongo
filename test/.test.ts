// deno-lint-ignore-file no-explicit-any
import { FindQuery, FindOneQuery } from "../lib/query/find.ts";
import { Mongo, ObjectId } from "../mod.ts";
import e from "../validator.ts";

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

const User1Id = new ObjectId();
const User2Id = new ObjectId();

const UsersData = [
  {
    _id: User1Id,
    username: "saffellikhan",
    profile: {
      name: "Saif Ali Khan",
      // dob: new Date(),
    },
    activity: [
      {
        description: "Logged in!",
        user: User1Id,
      },
      {
        description: "Waved by someone!",
        user: User2Id,
      },
    ],
    latestActivity: {
      description: "Waved by someone!",
      user: User2Id,
    },
  },
  {
    _id: User2Id,
    username: "abdullah",
    password: "secret3",
    profile: {
      name: "Abdullah Khan",
      dob: new Date(),
    },
    activity: [
      {
        description: "Waved by someone!",
        user: User1Id,
      },
    ],
    latestActivity: {
      description: "Waved by someone!",
      user: User1Id,
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

    // Activity Schema
    const ActivitySchema = () =>
      e.object({
        description: e.string(),
        user: e.instanceOf(ObjectId, { instantiate: true }),
      });

    // User Schema
    const UserSchema = () =>
      e.object({
        _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
        username: e.string(),
        password: e.optional(e.string()).default("topSecret"),
        profile: e.object({
          name: e.string(),
          dob: e.optional(e.date()).default(() => new Date()),
        }),
        age: e.optional(e.number()).default(18),
        followers: e.optional(e.array(e.if(ObjectId.isValid))),
        posts: e.optional(e.array(e.if(ObjectId.isValid))),
        latestPost: e.optional(e.if(ObjectId.isValid)),
        activity: e.optional(e.array(ActivitySchema)),
        latestActivity: e.optional(ActivitySchema),
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

    // Activity with Populates
    const ActivityWithPopulatesSchema = () =>
      e.object({
        description: e.string(),
        user: UserSchema,
      });

    // Post Schema
    const PostSchema = () =>
      e.object({
        _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
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

    // User with Populates
    const UserWithPopulatesSchema = e
      .omit(e.required(UserSchema, { ignore: ["followers"] }), {
        keys: ["posts", "latestPost", "activity", "latestActivity"],
      })
      .extends(
        e.partial(
          e.object({
            posts: e.array(PostSchema),
            latestPost: PostSchema,
            activity: e.array(ActivityWithPopulatesSchema),
            latestActivity: ActivityWithPopulatesSchema,
          })
        )
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
      await PostSchema().validate(Post);

      // Relate first User with the Post
      await UserModel.updateOne(Users[0]._id, {
        posts: [Post._id],
        latestPost: Post._id,
      });
    });

    await t.step("Fetch with populate", async () => {
      const Query = UserModel.find()
        .populate("posts", PostModel)
        .populateOne("latestPost", PostModel)
        .populateOne("activity.user", UserModel)
        .populateOne("latestActivity.user", UserModel);

      const Users = await e.instanceOf(FindQuery).validate(Query);

      await e
        .array(UserWithPopulatesSchema)
        .validate(Users)
        .catch((error) => {
          console.error(error, Users);
          throw error;
        });
    });

    await t.step("Fetch One with populate", async () => {
      const Query = UserModel.findOne()
        .populate("posts", PostModel)
        .populateOne("latestPost", PostModel)
        .populateOne("activity.user", UserModel)
        .populateOne("latestActivity.user", UserModel);

      const Users = await e.instanceOf(FindOneQuery).validate(Query);

      await UserWithPopulatesSchema.validate(Users).catch((error) => {
        console.error(error, Users);
        throw error;
      });
    });

    await t.step("Updates", async () => {
      // Wait for a sec to fix the time issue
      await new Promise((_) => setTimeout(_, 1000));

      const Users = await UserModel.updateAndFindMany(
        {},
        { "profile.dob": new Date() }
      );

      Users.map((user, i) => {
        if (
          user.profile.dob.toString() === UsersData[i].profile.dob?.toString()
        )
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

      await PostModel.deleteMany();

      if ((await PostModel.count()) !== 0)
        throw new Error(`Deletion not correct!`);
    });

    await t.step("Transaction Rollback Test", async () => {
      try {
        await Mongo.transaction(async (session) => {
          // Create Users
          const Users = await UserModel.createMany(UsersData, { session });

          // Check if the result is a valid Users list
          await e.array(UserSchema).validate(Users);

          // Create Post
          const Post = await PostModel.create(PostsData[0], { session });

          // Check if the result is a valid Post
          await PostSchema().validate(Post);

          // Relate first User with the Post
          await UserModel.updateOne(
            Users[0]._id,
            {
              $push: { posts: Post._id },
              latestPost: Post._id,
            },
            { session }
          );

          throw new Error(`Transaction cancelled!`);
        });

        throw new Error(`This transaction should not execute!`);
      } catch {
        if ((await UserModel.count()) !== 0 || (await PostModel.count()) !== 0)
          throw new Error(`Transaction rollback not working!`);
      }
    });

    await t.step("Transaction Commit Test", async () => {
      await Mongo.transaction(async (session) => {
        // Create Users
        const Users = await UserModel.createMany(UsersData, { session });

        // Check if the result is a valid Users list
        await e.array(UserSchema).validate(Users);

        // Create Post
        const Post = await PostModel.create(PostsData[0], { session });

        // Check if the result is a valid Post
        await PostSchema().validate(Post);

        // Check the data consistancy in the current session
        if (
          (await UserModel.count({}, { session })) === 0 ||
          (await PostModel.count({}, { session })) === 0
        )
          throw new Error(`Transaction commit not working!`);

        // Relate first User with the Post
        await UserModel.updateOne(
          Users[0]._id,
          {
            $push: { posts: Post._id },
            latestPost: Post._id,
          },
          { session }
        );
      });

      if ((await UserModel.count()) === 0 || (await PostModel.count()) === 0)
        throw new Error(`Transaction commit not working!`);
    });

    Mongo.disconnect();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
