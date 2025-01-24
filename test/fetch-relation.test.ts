import e from "../validator.ts";
import { Mongo, ObjectId } from "../mod.ts";

Deno.test({
  name: "Fetch relationships from other connections",
  async fn(t) {
    const UserSchema = e.object({
      _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
      username: e.string(),
      password: e.string(),
      posts: e.optional(e.array(e.instanceOf(ObjectId, { instantiate: true }))),
      timeline: e.optional(e.array(e.object({
        user: e.instanceOf(ObjectId, { instantiate: true }),
        post: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
        collaborators: e.optional(
          e.array(e.instanceOf(ObjectId, { instantiate: true })),
        ),
      }))),
    });

    const UserModel = Mongo.model("user", UserSchema, 0);

    const PostSchema = e.object({
      _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
      title: e.string(),
    });

    const PostModel = Mongo.model("post", PostSchema, 1);

    const CheckSchema = e.object({
      _id: e.instanceOf(ObjectId, { instantiate: true }),
      posts: e.array(PostSchema),
      timeline: e.array(e.object({
        user: e.object({
          _id: e.instanceOf(ObjectId, { instantiate: true }),
          username: e.string(),
        }),
        post: e.optional(e.object({
          _id: e.instanceOf(ObjectId, { instantiate: true }),
          title: e.string(),
        })),
        collaborators: e.optional(e.array(e.object({
          _id: e.instanceOf(ObjectId, { instantiate: true }),
          username: e.string(),
        }))),
      })),
    }).extends(e.omit(UserSchema, ["_id", "posts", "timeline"]));

    Mongo.enableLogs = true;

    await Mongo.connect(
      `
      mongodb://localhost:27017/mongo-1,
      mongodb://localhost:27017/mongo-2
      `,
    );

    await Mongo.dropAll();

    await t.step("Create Users and Posts", async () => {
      const [post1, post2] = await PostModel.createMany([{
        title: "post 1",
      }, {
        title: "post 2",
      }]);

      const user1 = await UserModel.create({
        username: "saif",
        password: "saif",
        posts: [post1._id],
        timeline: [],
      });

      const user2 = await UserModel.create({
        username: "john",
        password: "john",
        posts: [],
        timeline: [{
          user: user1._id,
        }],
      });

      const _user3 = await UserModel.create({
        username: "jean",
        password: "jean",
        posts: [post1._id, post2._id],
        timeline: [{
          user: user1._id,
        }, {
          user: user2._id,
          post: post2._id,
        }, {
          user: user1._id,
          post: post1._id,
          collaborators: [user1._id, user2._id],
        }],
      });

      const Results = await UserModel.find()
        .fetch("posts", PostModel)
        .fetchOne("timeline.user", UserModel, { project: { username: 1 } })
        .fetchOne("timeline.post", PostModel, { project: { title: 1 } })
        .fetch("timeline.collaborators", UserModel, {
          project: { username: 1 },
        });

      await e.array(CheckSchema).validate(Results);
    });

    await t.step("Validate relation data type", async () => {
      const user = await UserModel.create({
        username: "saff",
        password: "saff",
      });

      const Results = await UserModel.findOne(user._id)
        .fetchOne("timeline.user", UserModel, { project: { username: 1 } });

      if (!Results) {
        throw new Error("User was not created!");
      }

      if (Results.timeline && !(Results.timeline instanceof Array)) {
        throw new Error("Timeline is not an array");
      }
    });

    await Mongo.disconnect();
  },
  sanitizeResources: true,
  sanitizeOps: true,
});
